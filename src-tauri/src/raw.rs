//! Canon CR3 raw photos. A CR3 is an ISO BMFF file whose first track is a full-size JPEG the
//! camera rendered (its picture style and white balance), which is what Stipple converts: the
//! engine works far below 6000 px, so decoding the raw sensor data would gain nothing. That JPEG
//! has no EXIF, so the camera's orientation (the TIFF IFD0 in the CMT1 box) is written into it
//! as a small EXIF segment, which the webview's decoder applies.
//!
//! Only the moov box and the JPEG are read, never the raw data.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Canon's metadata box inside moov.
const CANON_UUID: [u8; 16] = [
    0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0, 0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48,
];
const MAX_MOOV: u64 = 16 * 1024 * 1024;
const MAX_JPEG: u64 = 64 * 1024 * 1024;

/// A box: its type and where its payload lies (absolute file offsets for top-level boxes,
/// offsets into the parent's slice for nested ones).
struct BoxAt {
    kind: [u8; 4],
    start: u64,
    end: u64,
}

/// Parses one box header at `off` from `head` (at least 16 bytes when available); `limit` is
/// the parent's end. None when the header is malformed.
fn box_header(head: &[u8], off: u64, limit: u64) -> Option<BoxAt> {
    let size = u32::from_be_bytes(head.get(0..4)?.try_into().ok()?) as u64;
    let kind: [u8; 4] = head.get(4..8)?.try_into().ok()?;
    let (size, hdr) = match size {
        0 => (limit - off, 8),
        1 => (u64::from_be_bytes(head.get(8..16)?.try_into().ok()?), 16),
        s => (s, 8),
    };
    let end = off.checked_add(size)?;
    (size >= hdr && end <= limit).then_some(BoxAt { kind, start: off + hdr, end })
}

/// The child boxes of `data[range]`.
fn children(data: &[u8], start: usize, end: usize) -> Vec<BoxAt> {
    let mut out = Vec::new();
    let mut off = start;
    while off + 8 <= end {
        let head = &data[off..end.min(off + 16)];
        let Some(b) = box_header(head, off as u64, end as u64) else { break };
        off = b.end as usize;
        out.push(b);
    }
    out
}

fn child<'a>(boxes: &'a [BoxAt], kind: &[u8; 4]) -> Option<&'a BoxAt> {
    boxes.iter().find(|b| &b.kind == kind)
}

fn be32(d: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(d.get(at..at + 4)?.try_into().ok()?))
}

/// The moov box's bytes (file offsets are what its co64 boxes hold).
fn read_moov(f: &mut File) -> Result<Vec<u8>, String> {
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    let mut off = 0u64;
    let mut first = true;
    while off + 8 <= len {
        let mut head = [0u8; 16];
        f.seek(SeekFrom::Start(off)).map_err(|e| e.to_string())?;
        let n = f.read(&mut head).map_err(|e| e.to_string())?;
        let b = box_header(&head[..n], off, len).ok_or("the file is damaged")?;
        if first && (&b.kind != b"ftyp" || head.get(8..12) != Some(b"crx ")) {
            return Err("it is not a Canon CR3 file".into());
        }
        first = false;
        if &b.kind == b"moov" {
            if b.end - b.start > MAX_MOOV {
                return Err("the file is damaged".into());
            }
            let mut moov = vec![0u8; (b.end - b.start) as usize];
            f.seek(SeekFrom::Start(b.start)).map_err(|e| e.to_string())?;
            f.read_exact(&mut moov).map_err(|e| e.to_string())?;
            return Ok(moov);
        }
        off = b.end;
    }
    Err("the file is damaged".into())
}

/// Offset and size of the first track's single sample: the full-size JPEG.
fn jpeg_location(moov: &[u8]) -> Option<(u64, u64)> {
    let top = children(moov, 0, moov.len());
    let trak = child(&top, b"trak")?;
    let path: [&[u8; 4]; 3] = [b"mdia", b"minf", b"stbl"];
    let mut b = (trak.start as usize, trak.end as usize);
    for kind in path {
        let c = children(moov, b.0, b.1);
        let n = child(&c, kind)?;
        b = (n.start as usize, n.end as usize);
    }
    let stbl = children(moov, b.0, b.1);
    // stsz: version/flags, uniform sample size (0 = listed), count, then sizes
    let stsz = child(&stbl, b"stsz")?.start as usize;
    let size = match be32(moov, stsz + 4)? {
        0 => be32(moov, stsz + 12)?,
        s => s,
    };
    // co64: version/flags, count, then 64-bit offsets
    let co64 = child(&stbl, b"co64")?.start as usize;
    let offset = u64::from_be_bytes(moov.get(co64 + 8..co64 + 16)?.try_into().ok()?);
    Some((offset, size as u64))
}

/// The EXIF orientation (1-8) from CMT1, the TIFF header and IFD0; 1 when it is missing.
fn orientation(moov: &[u8]) -> u16 {
    let find = || -> Option<u16> {
        let top = children(moov, 0, moov.len());
        let uuid = top.iter().find(|b| {
            &b.kind == b"uuid" && moov.get(b.start as usize..b.start as usize + 16) == Some(&CANON_UUID)
        })?;
        let inner = children(moov, uuid.start as usize + 16, uuid.end as usize);
        let cmt1 = child(&inner, b"CMT1")?;
        let t = moov.get(cmt1.start as usize..cmt1.end as usize)?;
        let le = match t.get(0..4)? {
            b"II*\0" => true,
            b"MM\0*" => false,
            _ => return None,
        };
        let u16_at = |at: usize| -> Option<u16> {
            let b: [u8; 2] = t.get(at..at + 2)?.try_into().ok()?;
            Some(if le { u16::from_le_bytes(b) } else { u16::from_be_bytes(b) })
        };
        let u32_at = |at: usize| -> Option<u32> {
            let b: [u8; 4] = t.get(at..at + 4)?.try_into().ok()?;
            Some(if le { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) })
        };
        let ifd = u32_at(4)? as usize;
        for i in 0..u16_at(ifd)? as usize {
            let e = ifd + 2 + i * 12;
            if u16_at(e)? == 0x0112 {
                return u16_at(e + 8).filter(|o| (1..=8).contains(o));
            }
        }
        None
    };
    find().unwrap_or(1)
}

/// `jpeg` with an APP1 EXIF segment holding only `orientation`, right after SOI.
fn with_orientation(jpeg: Vec<u8>, orientation: u16) -> Vec<u8> {
    if orientation == 1 {
        return jpeg;
    }
    let mut seg = vec![0xff, 0xe1, 0, 34];
    seg.extend(b"Exif\0\0");
    seg.extend(b"MM\0*\0\0\0\x08"); // big-endian TIFF, IFD0 at 8
    seg.extend([0, 1]); // one entry
    seg.extend([0x01, 0x12, 0, 3, 0, 0, 0, 1]); // Orientation, SHORT, count 1
    seg.extend(orientation.to_be_bytes());
    seg.extend([0, 0]);
    seg.extend([0, 0, 0, 0]); // no next IFD
    let mut out = Vec::with_capacity(jpeg.len() + seg.len());
    out.extend(&jpeg[..2]);
    out.extend(seg);
    out.extend(&jpeg[2..]);
    out
}

/// The camera's full-size JPEG from a CR3, with its orientation.
pub fn cr3_jpeg(path: &Path) -> Result<Vec<u8>, String> {
    let err = |e: String| format!("{} can't be read: {e}", path.display());
    let mut f = File::open(path).map_err(|e| err(e.to_string()))?;
    let moov = read_moov(&mut f).map_err(err)?;
    let (offset, size) = jpeg_location(&moov).ok_or_else(|| err("it has no preview image".into()))?;
    if size > MAX_JPEG {
        return Err(err("its preview image is too large".into()));
    }
    let mut jpeg = vec![0u8; size as usize];
    f.seek(SeekFrom::Start(offset)).map_err(|e| err(e.to_string()))?;
    f.read_exact(&mut jpeg).map_err(|e| err(e.to_string()))?;
    if !jpeg.starts_with(&[0xff, 0xd8]) {
        return Err(err("its preview image is not a JPEG".into()));
    }
    Ok(with_orientation(jpeg, orientation(&moov)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orientation_segment() {
        let j = with_orientation(vec![0xff, 0xd8, 0xff, 0xd9], 6);
        assert_eq!(&j[..4], &[0xff, 0xd8, 0xff, 0xe1]);
        // the length field counts itself and the payload: all but SOI, the marker and EOI
        assert_eq!(u16::from_be_bytes([j[4], j[5]]) as usize, j.len() - 6);
        assert_eq!(&j[j.len() - 2..], &[0xff, 0xd9]);
        assert_eq!(with_orientation(vec![0xff, 0xd8], 1), vec![0xff, 0xd8]);
    }

    #[test]
    fn rejects_non_cr3() {
        let p = std::env::temp_dir().join(format!("stipple-raw-{}.cr3", std::process::id()));
        std::fs::write(&p, b"\0\0\0\x10ftypisom\0\0\0\0").unwrap();
        assert!(cr3_jpeg(&p).unwrap_err().contains("not a Canon CR3"));
        let _ = std::fs::remove_file(&p);
    }

    /// Set STIPPLE_CR3 to a real CR3 to check the extraction end to end.
    #[test]
    fn real_file() {
        let Ok(p) = std::env::var("STIPPLE_CR3") else { return };
        let j = cr3_jpeg(Path::new(&p)).unwrap();
        assert!(j.starts_with(&[0xff, 0xd8]));
        if let Ok(out) = std::env::var("STIPPLE_CR3_OUT") {
            std::fs::write(out, &j).unwrap();
        }
    }
}
