import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { loadMedia } from "../src/media/load.js";
import {
  assertPathAllowed,
  assertUrlSafe,
  detectMime,
} from "../src/media/security.js";
import {
  clampBox,
  dimensions,
  downscaleToEdge,
  gridCells,
  subdivide,
  toDataUri,
} from "../src/media/transform.js";
import { makePng } from "./mocks/provider.js";

describe("security.detectMime", () => {
  it("detects PNG from magic bytes", async () => {
    expect(detectMime(await makePng())).toBe("image/png");
  });
  it("returns undefined for random bytes", () => {
    expect(detectMime(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeUndefined();
  });
});

describe("security.assertPathAllowed", () => {
  const root = path.resolve(os.tmpdir());
  it("allows a path inside an allowed dir", () => {
    expect(() => assertPathAllowed(path.join(root, "a", "b.png"), [root])).not.toThrow();
  });
  it("rejects path traversal escaping the allowed dir", () => {
    expect(() => assertPathAllowed(path.join(root, "..", "..", "etc", "passwd"), [root])).toThrow();
  });
});

describe("security.assertUrlSafe (SSRF)", () => {
  it("rejects loopback / private / link-local IPs", async () => {
    await expect(assertUrlSafe("http://127.0.0.1/x")).rejects.toThrow();
    await expect(assertUrlSafe("http://10.0.0.1/x")).rejects.toThrow();
    await expect(assertUrlSafe("http://169.254.1.1/x")).rejects.toThrow();
    await expect(assertUrlSafe("http://192.168.1.5/x")).rejects.toThrow();
  });
  it("rejects non-http(s) schemes", async () => {
    await expect(assertUrlSafe("ftp://example.com/x")).rejects.toThrow();
  });
  it("allows a public IP literal", async () => {
    await expect(assertUrlSafe("http://1.1.1.1/x")).resolves.toBeInstanceOf(URL);
  });
});

describe("transform", () => {
  it("reports dimensions", async () => {
    expect(await dimensions(await makePng(320, 200))).toEqual({ width: 320, height: 200 });
  });
  it("downscales to max edge", async () => {
    const small = await downscaleToEdge(await makePng(800, 400), 100);
    const d = await dimensions(small);
    expect(Math.max(d.width, d.height)).toBeLessThanOrEqual(100);
  });
  it("subdivide splits a box into n*n cells", () => {
    const cells = subdivide([0, 0, 1, 1], 3);
    expect(cells).toHaveLength(9);
    expect(cells[0]).toEqual([0, 0, 1 / 3, 1 / 3]);
  });
  it("gridCells matches subdivide of the unit box", () => {
    expect(gridCells(3)).toHaveLength(9);
  });
  it("clampBox clamps out-of-range coords with non-zero area", () => {
    const [x, y, w, h] = clampBox([-0.5, 1.2, 5, 5]);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(1);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });
});

describe("loadMedia", () => {
  const cfg = loadConfig({ VISION_ALLOWED_DIRS: os.tmpdir() } as NodeJS.ProcessEnv);

  it("loads a data URI image and keeps original + overview", async () => {
    const dataUri = toDataUri(await makePng(400, 400), "image/png");
    const m = await loadMedia(dataUri, cfg);
    expect(m.kind).toBe("image");
    expect(m.original).toBeInstanceOf(Buffer);
    expect(m.overviewRef.dataUri).toMatch(/^data:image\/png;base64,/);
    expect(m.passthrough).toBe(false);
  });

  it("rejects a local path outside allowed dirs", async () => {
    await expect(loadMedia(path.resolve("/etc/passwd"), cfg)).rejects.toThrow();
  });
});
