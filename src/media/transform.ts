import sharp from "sharp";

/** A normalized bounding box: x, y, w, h all in [0, 1]. */
export type NormBox = [x: number, y: number, w: number, h: number];

export interface Dimensions {
  width: number;
  height: number;
}

export async function dimensions(buf: Buffer): Promise<Dimensions> {
  const meta = await sharp(buf).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

/** Downscale so the longest edge is at most `maxEdge`. Never upscales here. */
export async function downscaleToEdge(buf: Buffer, maxEdge: number): Promise<Buffer> {
  const { width, height } = await dimensions(buf);
  if (width <= maxEdge && height <= maxEdge) return buf;
  return sharp(buf)
    .resize({ width, height, fit: "inside", withoutEnlargement: true })
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Clamp a normalized box to valid bounds, guaranteeing non-zero area. */
export function clampBox([x, y, w, h]: NormBox): NormBox {
  const cx = clamp01(x);
  const cy = clamp01(y);
  const cw = clamp01(w);
  const ch = clamp01(h);
  return [cx, cy, Math.max(0.01, Math.min(cw, 1 - cx)), Math.max(0.01, Math.min(ch, 1 - cy))];
}

/**
 * Crop a normalized region from the FULL-RESOLUTION buffer (never the overview),
 * then optionally upscale + sharpen so small details become legible.
 */
export async function cropAndZoom(
  original: Buffer,
  box: NormBox,
  opts: { upscale?: number; sharpen?: boolean } = {},
): Promise<Buffer> {
  const { width, height } = await dimensions(original);
  const [nx, ny, nw, nh] = clampBox(box);
  const left = Math.floor(nx * width);
  const top = Math.floor(ny * height);
  const w = Math.max(1, Math.floor(nw * width));
  const h = Math.max(1, Math.floor(nh * height));

  let pipeline = sharp(original).extract({
    left: Math.min(left, width - 1),
    top: Math.min(top, height - 1),
    width: Math.min(w, width - left),
    height: Math.min(h, height - top),
  });

  const upscale = opts.upscale ?? 1;
  if (upscale > 1) {
    pipeline = pipeline.resize({ width: Math.round(w * upscale), kernel: "lanczos3" });
  }
  if (opts.sharpen) pipeline = pipeline.sharpen();
  return pipeline.png().toBuffer();
}

/**
 * Render a normalized region from the full-resolution original for a zoom view:
 * crop, then fit the longest edge to `maxEdge` (enlargement allowed, so a small
 * region fills the model's input budget instead of staying tiny).
 */
export async function renderRegion(original: Buffer, box: NormBox, maxEdge: number): Promise<Buffer> {
  const { width, height } = await dimensions(original);
  const [nx, ny, nw, nh] = clampBox(box);
  const left = Math.min(Math.floor(nx * width), width - 1);
  const top = Math.min(Math.floor(ny * height), height - 1);
  const w = Math.max(1, Math.min(Math.floor(nw * width), width - left));
  const h = Math.max(1, Math.min(Math.floor(nh * height), height - top));
  return sharp(original)
    .extract({ left, top, width: w, height: h })
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: false, kernel: "lanczos3" })
    .png()
    .toBuffer();
}

/** Subdivide a normalized box into an n×n grid of absolute normalized boxes. */
export function subdivide([x, y, w, h]: NormBox, n: number): NormBox[] {
  const out: NormBox[] = [];
  const sw = w / n;
  const sh = h / n;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      out.push([x + col * sw, y + row * sh, sw, sh]);
    }
  }
  return out;
}

/** Normalized boxes for an n×n grid, row-major (index 0 = top-left). */
export function gridCells(n: number): NormBox[] {
  const cells: NormBox[] = [];
  const step = 1 / n;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      cells.push([col * step, row * step, step, step]);
    }
  }
  return cells;
}

export function toDataUri(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}
