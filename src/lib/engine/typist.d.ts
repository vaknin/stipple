// Types for the vendored Typist engine (src/lib/typist/js, plain ES modules). Only the exports this
// app uses are declared. `$typist` is a Vite alias (vite.config.ts) that TypeScript does not
// resolve, so these ambient declarations are what the imports type-check against.
// No top-level import/export here: this file must stay a global script for `declare module`.

declare module '$typist/tone.js' {
  export type LookId = 'photo' | 'texture' | 'sketch' | 'soft' | 'poster';
  export interface Look { readonly id: LookId; readonly name: string }
  export const LOOKS: readonly Look[];

  export interface Tone {
    look: LookId;
    auto: boolean;
    brightness: number;
    contrast: number;
    gamma: number;
    detail: number;
    edges: number;
    invert: boolean;
  }
  export const TONE_DEFAULTS: Readonly<Tone>;

  /**
   * The crop: centre in normalised photo coords, zoom (1 = the largest such crop on the photo),
   * clockwise degrees, and (Stipple) aspect = width / height, missing = 1, the square.
   */
  export interface Crop { x: number; y: number; zoom: number; rotation: number; aspect?: number }
  export const CROP_DEFAULTS: Readonly<Crop>;

  export const DECODE_MAX: number;
  export function cropSide(width: number, height: number, crop: Partial<Crop> | null): number;
  export function cropAspect(crop: Partial<Crop> | null | undefined): number;
  /** [width, height] of the crop in source pixels. */
  export function cropSize(width: number, height: number, crop: Partial<Crop> | null): [number, number];

  export interface ToneStats {
    look: LookId;
    lo: number;
    hi: number;
    gamma: number;
    coverage: number;
    std: number;
    flat: boolean;
  }
}

declare module '$typist/convert.js' {
  import type { Crop, Tone, ToneStats } from '$typist/tone.js';
  export { LOOKS, TONE_DEFAULTS, CROP_DEFAULTS } from '$typist/tone.js';

  export type Mode = 'braille' | 'ascii' | 'blocks';
  export type Dither = 'atkinson' | 'floyd' | 'bayer' | 'threshold';
  export type AsciiMethod = 'shape' | 'ramp';
  export type BlocksKind = 'quad' | 'half';

  export const DITHERS: readonly Dither[];

  export interface ConvertOpts {
    mode: Mode;
    cols: number;
    rows: number;
    dither: Dither;
    ascii: AsciiMethod;
    blocks: BlocksKind;
    color: boolean;
    tone: Partial<Tone>;
  }

  /** One cell per code point, row-major. fg / bg are 0xRRGGBB per cell (colour blocks only). */
  export interface Grid {
    mode: Mode;
    cols: number;
    rows: number;
    cp: Uint32Array;
    fg: Uint32Array | null;
    bg: Uint32Array | null;
    ink: number;
    tone?: ToneStats;
  }

  /** Raw RGBA pixels, as ImageData has them. */
  export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

  export interface Converter {
    readonly stats: { samples: number; tones: number; encodes: number };
    readonly asciiReady: boolean;
    setSource(source: CanvasImageSource | OffscreenCanvas | Pixels | null): void;
    readonly decoded: Pixels | null;
    readonly decodeMs: number;
    run(crop: Partial<Crop>, opts: Partial<ConvertOpts>): Grid;
  }

  export function createConverter(): Converter;
  export function gridLines(grid: Pick<Grid, 'cols' | 'rows' | 'cp'>): string[];
}

declare module '$typist/raster.js' {
  import type { Grid } from '$typist/convert.js';

  export interface DrawOpts {
    x?: number;
    y?: number;
    cellW?: number;
    cellH?: number;
    ink?: string;
    paper?: string | null;
    font?: string;
    dotR?: number;
    ghost?: number;
  }
  export function drawGrid(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    grid: Grid,
    opts?: DrawOpts,
  ): { width: number; height: number };
  export function brailleGeometry(cellW: number, cellH: number, dotR?: number): {
    r: number;
    centers: [number, number][];
  };
  /** Block glyph -> quadrant mask (UL=1, UR=2, LL=4, LR=8). */
  export const BLOCK_MASK: Map<number, number>;
}

declare module '$typist/imageio.js' {
  import type { Crop } from '$typist/tone.js';

  export const WORK_MAX: number;
  export type ImageErrorCode = 'type' | 'heic' | 'decode' | 'empty';
  export class ImageError extends Error {
    constructor(code: ImageErrorCode, message?: string);
    code: ImageErrorCode;
  }
  export function imageErrorMessage(err: unknown): string;

  /** The working image: EXIF-rotated, long edge <= WORK_MAX, alpha kept. */
  export interface Photo {
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
    name: string;
    alphaBox: { x0: number; y0: number; x1: number; y1: number } | null;
    small: boolean;
  }
  export function decodeImage(blob: Blob, name?: string): Promise<Photo>;
  export function autoCrop(img: Pick<Photo, 'width' | 'height' | 'alphaBox'>, aspect?: number): Crop;
}

declare module '$typist/crop.js' {
  import type { Crop } from '$typist/tone.js';

  export const ZOOM_MIN: number;
  export const ZOOM_MAX: number;
  export function cleanCrop(c: Partial<Crop> | null | undefined): Crop;
  export function fitCropFor(crop: Partial<Crop>, width?: number, height?: number): Crop;

  export interface CropperOpts {
    host: HTMLElement;
    image: HTMLCanvasElement;
    crop: Partial<Crop>;
    onChange?: (crop: Crop, info: { live: boolean }) => void;
    onCommit?: (crop: Crop, info: { changed: boolean }) => void;
    onCancel?: (startCrop: Crop) => void;
    controls?: boolean;
    buttons?: boolean;
    fitCrop?: ((image: HTMLCanvasElement, crop: Crop) => Partial<Crop>) | null;
  }
  export interface Cropper {
    enter(crop?: Partial<Crop>): void;
    exit(apply?: boolean): void;
    setImage(image: HTMLCanvasElement | null, crop?: Partial<Crop>): void;
    rotate90(): void;
    fit(): void;
    destroy(): void;
    readonly el: HTMLDivElement;
    readonly crop: Crop;
    readonly active: boolean;
    readonly canvas: HTMLCanvasElement;
  }
  export function createCropper(opts: CropperOpts): Cropper;
}

declare module '$typist/history.js' {
  export class History<T = unknown> {
    constructor(opts?: { limit?: number; mergeMs?: number; onChange?: (h: History<T>) => void });
    limit: number;
    mergeMs: number;
    stack: string[];
    labels: (string | null)[];
    index: number;
    lastLabel: string | null;
    lastTime: number;
    onChange?: (h: History<T>) => void;
    reset(snapshot: T): void;
    commit(snapshot: T, label?: string): boolean;
    seal(): void;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly undoLabel: string | null;
    readonly redoLabel: string | null;
    undo(): T | null;
    redo(): T | null;
  }
}

declare module '$typist/targets.js' {
  import type { Mode } from '$typist/convert.js';
  /** Cell width / height as the target renders it ('plain' = Typist's File target). */
  export function cellAspect(id: 'plain', mode: Mode): number;
  /** Rows that keep a square crop square for a cell aspect. */
  export function rowsFor(cols: number, aspect: number): number;
}

declare module '$typist/export.js' {
  export const INK: string;
  export const PAPER: string;
  export const MONO_STACK: string;
}
