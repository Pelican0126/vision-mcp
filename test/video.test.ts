import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectMime } from "../src/media/security.js";
import { sampleFrames } from "../src/media/video.js";

async function ffmpegPath(): Promise<string | null> {
  try {
    const m = (await import("ffmpeg-static")) as unknown as { default?: string };
    return m.default ?? null;
  } catch {
    return null;
  }
}

describe("video frame sampling", () => {
  it("samples PNG frames from a generated clip", async () => {
    const ff = await ffmpegPath();
    if (!ff) return; // skip gracefully when ffmpeg-static is unavailable

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vmt-"));
    const clip = path.join(dir, "t.mp4");
    await new Promise<void>((resolve, reject) => {
      const p = spawn(ff, [
        "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=160x120:rate=8",
        "-pix_fmt", "yuv420p", clip,
      ]);
      p.on("error", reject);
      p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`gen exit ${c}`))));
    });

    const frames = await sampleFrames(await fs.readFile(clip), 4, 128);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThanOrEqual(4);
    expect(detectMime(frames[0]!)).toBe("image/png");

    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }, 30_000);
});
