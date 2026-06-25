import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Read an image from the OS clipboard → PNG/binary Buffer.
 *
 * This powers the `clipboard` pseudo-source so a TEXT-ONLY host never receives
 * image bytes: the user screenshots/copies an image, the agent calls a tool
 * with `image="clipboard"`, and the MCP grabs the image here. Implemented by
 * shelling out to OS-native tools — no npm dependency / no plugin.
 */
export async function readClipboardImage(): Promise<Buffer> {
  switch (process.platform) {
    case "win32":
      return readWindows();
    case "darwin":
      return readMac();
    default:
      return readLinux();
  }
}

const NO_IMAGE = "剪贴板里没有图片（请先把图片放到剪贴板：截图 Win+Shift+S，或复制一张图片文件）。";

async function readWindows(): Promise<Buffer> {
  const out = path.join(os.tmpdir(), `vmcp-clip-${randomUUID()}.png`);
  // GetImage handles bitmaps (screenshots); GetFileDropList handles copied image files.
  const ps = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
    "$img = [System.Windows.Forms.Clipboard]::GetImage()",
    "if ($img -ne $null) {",
    `  $img.Save('${out}', [System.Drawing.Imaging.ImageFormat]::Png); 'IMG'`,
    "} else {",
    "  $files = [System.Windows.Forms.Clipboard]::GetFileDropList()",
    "  $pick = $null",
    "  foreach ($f in $files) { if ($f -match '\\.(png|jpg|jpeg|gif|bmp|webp)$') { $pick = $f; break } }",
    "  if ($pick) { 'FILE:' + $pick } else { 'NONE' }",
    "}",
  ].join("\n");
  const encoded = Buffer.from(ps, "utf16le").toString("base64");
  const stdout = await runText("powershell", [
    "-sta", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded,
  ]);
  const line = stdout.trim().split(/\r?\n/).pop()?.trim() ?? "";
  try {
    if (line === "IMG") return await fs.readFile(out);
    if (line.startsWith("FILE:")) return await fs.readFile(line.slice(5).trim());
    throw new Error(NO_IMAGE);
  } finally {
    await fs.rm(out, { force: true }).catch(() => {});
  }
}

async function readMac(): Promise<Buffer> {
  try {
    return await runBinary("pngpaste", ["-"]); // optional brew tool
  } catch {
    /* fall back to osascript */
  }
  const out = path.join(os.tmpdir(), `vmcp-clip-${randomUUID()}.png`);
  const script = [
    "try",
    "  set theData to the clipboard as «class PNGf»",
    `  set theFile to open for access POSIX file "${out}" with write permission`,
    "  write theData to theFile",
    "  close access theFile",
    '  return "IMG"',
    "on error",
    '  return "NONE"',
    "end try",
  ].join("\n");
  const res = await runText("osascript", ["-e", script]);
  try {
    if (res.trim().endsWith("IMG")) return await fs.readFile(out);
    throw new Error(NO_IMAGE);
  } finally {
    await fs.rm(out, { force: true }).catch(() => {});
  }
}

async function readLinux(): Promise<Buffer> {
  try {
    return await runBinary("wl-paste", ["--type", "image/png"]);
  } catch {
    /* try xclip */
  }
  try {
    return await runBinary("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]);
  } catch {
    throw new Error("无法读取 Linux 剪贴板图片（需要 wl-paste 或 xclip）。");
  }
}

/** Run a command and resolve its stdout as text (for status output). */
function runText(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `退出码 ${code}`))));
  });
}

/** Run a command and resolve its stdout as raw bytes (for binary image output). */
function runBinary(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    const chunks: Buffer[] = [];
    let err = "";
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length > 0) resolve(buf);
      else reject(new Error(err.trim() || `退出码 ${code}，无输出`));
    });
  });
}
