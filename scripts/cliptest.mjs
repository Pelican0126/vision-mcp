// Real Windows clipboard verification: put an image on the clipboard, then read
// it back through the compiled clipboard module. Run: node scripts/cliptest.mjs
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { readClipboardImage } from "../dist/media/clipboard.js";

const png = await sharp({
  create: { width: 200, height: 120, channels: 3, background: { r: 30, g: 140, b: 90 } },
})
  .png()
  .toBuffer();
const f = path.join(os.tmpdir(), `cliptest-${process.pid}.png`);
await fs.writeFile(f, png);

const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $img=[System.Drawing.Image]::FromFile('${f}'); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose(); 'SET'`;
await new Promise((res, rej) => {
  const p = spawn("powershell", ["-sta", "-NoProfile", "-Command", ps]);
  let o = "";
  p.stdout.on("data", (d) => (o += d));
  p.stderr.on("data", (d) => (o += d));
  p.on("close", (c) => (c === 0 ? res(o) : rej(new Error("set clipboard failed: " + o))));
});

const buf = await readClipboardImage();
const meta = await sharp(buf).metadata();
console.log(`clipboard read OK: ${buf.length} bytes, decoded ${meta.format} ${meta.width}x${meta.height}`);
await fs.rm(f, { force: true }).catch(() => {});
