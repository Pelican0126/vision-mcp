import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";

/** Detect a media MIME type from magic bytes. Returns undefined if unknown. */
export function detectMime(buf: Buffer): string | undefined {
  if (buf.length < 12) return undefined;
  // Images
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  const riff = buf.toString("ascii", 0, 4);
  if (riff === "RIFF") {
    const form = buf.toString("ascii", 8, 12);
    if (form === "WEBP") return "image/webp";
    if (form === "AVI ") return "video/x-msvideo";
  }
  // Videos
  if (buf.toString("ascii", 4, 8) === "ftyp") return "video/mp4"; // mp4/mov/m4v share ftyp
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm"; // EBML (webm/mkv)
  return undefined;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function isVideoMime(mime: string): boolean {
  return mime.startsWith("video/");
}

/**
 * Ensure `target` resolves inside one of `allowedDirs`. Prevents a confused or
 * malicious host from making us read e.g. ~/.ssh/id_rsa and ship it to an API.
 */
export function assertPathAllowed(target: string, allowedDirs: string[]): string {
  const resolved = path.resolve(target);
  const ok = allowedDirs.some((dir) => {
    const base = path.resolve(dir);
    const rel = path.relative(base, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!ok) {
    throw new Error(
      `路径不在允许目录内：${resolved}。请把它放进 VISION_ALLOWED_DIRS 之一（当前允许：${allowedDirs.join(", ")}）。`,
    );
  }
  return resolved;
}

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split(".").map((n) => Number.parseInt(n, 10));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false;
  const [a, b] = p as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
  return false;
}

function isPrivateAddress(ip: string): boolean {
  return net.isIPv4(ip) ? isPrivateIpv4(ip) : isPrivateIpv6(ip);
}

/**
 * SSRF guard: only http(s), and the resolved host must be a public address.
 * Returns the validated URL.
 */
export async function assertUrlSafe(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`无效 URL：${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`仅允许 http(s) URL，收到：${url.protocol}`);
  }
  const host = url.hostname;
  const candidates = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  for (const addr of candidates) {
    if (isPrivateAddress(addr)) {
      throw new Error(`拒绝访问私有/内网地址（SSRF 防护）：${host} → ${addr}`);
    }
  }
  return url;
}
