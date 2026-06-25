import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import type { VisionImageRef } from "../provider/types.js";
import { readClipboardImage } from "./clipboard.js";
import {
  assertPathAllowed,
  assertUrlSafe,
  detectMime,
  isImageMime,
  isVideoMime,
} from "./security.js";
import { downscaleToEdge, toDataUri } from "./transform.js";

export interface LoadedMedia {
  kind: "image" | "video";
  mime?: string;
  /** Full-resolution bytes; absent only for passthrough URLs (no crops possible). */
  original?: Buffer;
  /** Image ref for the coarse/overview pass: downsampled data URI, or a raw URL. */
  overviewRef: VisionImageRef;
  /** True when we hand the raw URL to the provider instead of downloading bytes. */
  passthrough: boolean;
}

interface RawBytes {
  buffer: Buffer;
  declaredMime?: string;
}

const DATA_URI_RE = /^data:([^;,]+)?(;base64)?,(.*)$/s;

/** Resolve one of: local path · file:// · http(s):// · data: URI → LoadedMedia. */
export async function loadMedia(input: string, cfg: Config): Promise<LoadedMedia> {
  const trimmed = input.trim();

  // http(s) with passthrough enabled → never download, just forward the URL.
  if (/^https?:\/\//i.test(trimmed) && cfg.allowUrlPassthrough) {
    await assertUrlSafe(trimmed);
    return { kind: "image", overviewRef: { url: trimmed }, passthrough: true };
  }

  const { buffer, declaredMime } = await readBytes(trimmed, cfg);
  const mime = detectMime(buffer) ?? declaredMime;
  if (!mime) throw new Error("无法识别媒体类型（magic bytes 不匹配已知图片/视频）。");

  if (isImageMime(mime)) {
    if (buffer.length > cfg.maxImageBytes) {
      throw new Error(`图片超过大小上限（${(cfg.maxImageBytes / 1048576).toFixed(0)}MB）。`);
    }
    const overview = await downscaleToEdge(buffer, cfg.maxEdgePx);
    return {
      kind: "image",
      mime,
      original: buffer,
      overviewRef: { dataUri: toDataUri(overview, "image/png") },
      passthrough: false,
    };
  }

  if (isVideoMime(mime)) {
    if (buffer.length > cfg.maxVideoBytes) {
      throw new Error(`视频超过大小上限（${(cfg.maxVideoBytes / 1048576).toFixed(0)}MB）。`);
    }
    // Frame sampling happens in media/video.ts (P3); here we keep the bytes.
    return {
      kind: "video",
      mime,
      original: buffer,
      overviewRef: { dataUri: toDataUri(buffer, mime) },
      passthrough: false,
    };
  }

  throw new Error(`不支持的媒体类型：${mime}`);
}

async function readBytes(input: string, cfg: Config): Promise<RawBytes> {
  // Pseudo-sources that pull the image server-side, so a text-only host never
  // receives image bytes (it only ever sends the literal "clipboard"/"latest").
  const keyword = input.toLowerCase();
  if (keyword === "clipboard" || keyword === "clip") {
    return { buffer: await readClipboardImage() };
  }
  if (keyword === "latest") {
    return { buffer: await readLatestFromDropDir(cfg) };
  }

  const dataMatch = DATA_URI_RE.exec(input);
  if (dataMatch) {
    const declaredMime = dataMatch[1] || undefined;
    const isBase64 = !!dataMatch[2];
    const payload = dataMatch[3] ?? "";
    const buffer = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { buffer, declaredMime };
  }

  if (/^https?:\/\//i.test(input)) {
    return downloadUrl(input, cfg);
  }

  // local path or file:// URL
  let filePath = input;
  if (/^file:\/\//i.test(input)) filePath = fileURLToPath(input);
  const safe = assertPathAllowed(filePath, cfg.allowedDirs);
  const buffer = await fs.readFile(safe);
  return { buffer };
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|bmp|webp)$/i;

/** Read the most-recently-modified image file in VISION_DROP_DIR. */
async function readLatestFromDropDir(cfg: Config): Promise<Buffer> {
  if (!cfg.dropDir) {
    throw new Error("未配置 VISION_DROP_DIR，无法使用 'latest'（请设置该环境变量指向截图目录）。");
  }
  let entries: string[];
  try {
    entries = await fs.readdir(cfg.dropDir);
  } catch {
    throw new Error(`VISION_DROP_DIR 不可读：${cfg.dropDir}`);
  }
  const stats = await Promise.all(
    entries
      .filter((e) => IMAGE_EXT_RE.test(e))
      .map(async (e) => {
        const p = path.join(cfg.dropDir!, e);
        const st = await fs.stat(p).catch(() => null);
        return st?.isFile() ? { p, mtime: st.mtimeMs } : null;
      }),
  );
  const files = stats.filter((s): s is { p: string; mtime: number } => s !== null).sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) throw new Error(`VISION_DROP_DIR 里没有图片：${cfg.dropDir}`);
  return fs.readFile(files[0]!.p);
}

async function downloadUrl(url: string, cfg: Config): Promise<RawBytes> {
  await assertUrlSafe(url);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`下载图片失败：${res.status} ${res.statusText} (${url})`);

  const declaredMime = res.headers.get("content-type")?.split(";")[0]?.trim();
  const declaredLen = Number.parseInt(res.headers.get("content-length") ?? "", 10);
  const cap = Math.max(cfg.maxImageBytes, cfg.maxVideoBytes);
  if (Number.isFinite(declaredLen) && declaredLen > cap) {
    throw new Error(`远程媒体超过大小上限。`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > cap) throw new Error(`远程媒体超过大小上限。`);
  return { buffer, declaredMime };
}
