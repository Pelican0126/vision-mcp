import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { downscaleToEdge } from "./transform.js";

/**
 * Universal video support: sample N evenly-spaced frames with ffmpeg and return
 * them as images. This works for ANY image-capable backend, so native-video
 * support (GLM/Kimi) becomes an optimization rather than a requirement.
 */
export async function sampleFrames(video: Buffer, frames: number, maxEdge: number): Promise<Buffer[]> {
  const ffmpegPath = await resolveFfmpeg();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vision-mcp-"));
  const input = path.join(dir, `in-${randomUUID()}`);
  try {
    await fs.writeFile(input, video);
    const duration = await probeDuration(ffmpegPath, input);
    const fps = duration > 0 ? Math.max(0.1, frames / duration) : 1;
    const pattern = path.join(dir, "frame-%03d.png");
    await run(ffmpegPath, ["-hide_banner", "-i", input, "-vf", `fps=${fps}`, "-frames:v", String(frames), pattern]);

    const files = (await fs.readdir(dir)).filter((f) => f.startsWith("frame-")).sort();
    const out: Buffer[] = [];
    for (const f of files.slice(0, frames)) {
      out.push(await downscaleToEdge(await fs.readFile(path.join(dir, f)), maxEdge));
    }
    if (out.length === 0) throw new Error("ffmpeg 未能从视频中抽出任何帧。");
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function resolveFfmpeg(): Promise<string> {
  try {
    const mod = (await import("ffmpeg-static")) as unknown as { default?: string };
    const p = mod.default ?? (mod as unknown as string);
    if (p && typeof p === "string") return p;
  } catch {
    /* fall through */
  }
  throw new Error("ffmpeg 不可用（ffmpeg-static 未安装）。请安装 ffmpeg-static 或配置支持原生视频的后端。");
}

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;

async function probeDuration(ffmpegPath: string, input: string): Promise<number> {
  const stderr = await run(ffmpegPath, ["-hide_banner", "-i", input, "-f", "null", "-"], true);
  const m = DURATION_RE.exec(stderr);
  if (!m) return 0;
  const [, hh, mm, ss] = m;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

function run(cmd: string, args: string[], tolerateFailure = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0 || tolerateFailure) resolve(stderr);
      else reject(new Error(`ffmpeg 退出码 ${code}：${stderr.slice(-400)}`));
    });
  });
}
