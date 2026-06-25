import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { makePng } from "./mocks/provider.js";

// Mock the OS-clipboard reader so the dispatch can be tested fully offline.
vi.mock("../src/media/clipboard.js", () => ({ readClipboardImage: vi.fn() }));

import { loadConfig } from "../src/config.js";
import { readClipboardImage } from "../src/media/clipboard.js";
import { loadMedia } from "../src/media/load.js";
import { dimensions } from "../src/media/transform.js";

describe("clipboard pseudo-source", () => {
  it("loadMedia('clipboard') reads the OS clipboard image", async () => {
    const png = await makePng(120, 80);
    vi.mocked(readClipboardImage).mockResolvedValue(png);
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    const m = await loadMedia("clipboard", cfg);
    expect(m.kind).toBe("image");
    expect(m.original?.equals(png)).toBe(true);
  });

  it("surfaces a clear error when the clipboard has no image", async () => {
    vi.mocked(readClipboardImage).mockRejectedValue(new Error("剪贴板里没有图片"));
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    await expect(loadMedia("clip", cfg)).rejects.toThrow(/剪贴板/);
  });
});

describe("latest pseudo-source", () => {
  it("picks the newest image in VISION_DROP_DIR", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vmdrop-"));
    const older = path.join(dir, "a.png");
    const newer = path.join(dir, "b.png");
    await fs.writeFile(older, await makePng(10, 10));
    await fs.writeFile(newer, await makePng(20, 20));
    const t = Date.now();
    await fs.utimes(older, new Date(t - 60_000), new Date(t - 60_000));
    await fs.utimes(newer, new Date(t), new Date(t));

    const cfg = loadConfig({ VISION_DROP_DIR: dir } as NodeJS.ProcessEnv);
    const m = await loadMedia("latest", cfg);
    expect((await dimensions(m.original!)).width).toBe(20); // the newer 20×20 file
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("throws when VISION_DROP_DIR is unset", async () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    await expect(loadMedia("latest", cfg)).rejects.toThrow(/VISION_DROP_DIR/);
  });
});
