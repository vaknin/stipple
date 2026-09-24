// Draw a Grid as an image (lab sheets, PNG export, previews). Braille and blocks are drawn as
// geometry, never with a font: fonts disagree on Braille (Windows' Segoe UI Symbol draws U+2800
// narrower than the other patterns) and on block glyph extents, and the film needs exactly this
// geometry so a frame of the film and the exported PNG show the same dots.
//
// Stipple patch: trimmed to the Braille geometry (src/lib/rasterize.ts draws the grid).

// Braille bit -> [column, row] inside the cell. Dots 1-3 = bits 0-2 (left column, rows 0-2),
// dots 4-6 = bits 3-5 (right column, rows 0-2), dot 7 = bit 6 (left, row 3), dot 8 = bit 7.
export const BRAILLE_SLOTS = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]];

/**
 * Dot geometry of one Braille cell, shared with the film. Dots sit on a 2 x 4 lattice centred in
 * the cell; the radius is dotR x the column pitch (research r_glyph-render: about 0.32), capped
 * so vertical neighbours never touch when a cell is squat.
 * Returns { r, centers: [[dx, dy] x 8] } with offsets from the cell's top-left corner, by bit.
 */
export function brailleGeometry(cellW, cellH, dotR = 0.32) {
  const px = cellW / 2, py = cellH / 4;
  const r = Math.min(dotR * px, 0.46 * py, 0.46 * px);
  const centers = BRAILLE_SLOTS.map(([c, rr]) => [(c + 0.5) * px, (rr + 0.5) * py]);
  return { r, centers };
}
