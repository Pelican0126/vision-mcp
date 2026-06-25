// End-to-end proof of the text-host fix: image on clipboard → MCP tool → backend → text.
// Run: KEY=... [MODEL=mimo-v2.5 PROFILE=mimo BASE=<endpoint>/v1] node scripts/clip-e2e.mjs
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";

const KEY = process.env.KEY;
const MODEL = process.env.MODEL || "glm-4.6v";
const PROFILE = process.env.PROFILE || "glm";
const BASE = process.env.BASE || "https://api.z.ai/api/paas/v4";

// 1. an error screenshot
const svg = `<svg width="900" height="560" xmlns="http://www.w3.org/2000/svg">
  <rect width="900" height="560" fill="#1e1e2e"/>
  <text x="50" y="100" font-size="54" fill="#fff" font-family="sans-serif">Build Dashboard</text>
  <rect x="560" y="40" width="300" height="56" rx="6" fill="#3a1a1a" stroke="#ff5555"/>
  <text x="576" y="76" font-size="19" fill="#ff6b6b" font-family="monospace">ERR-4096: NPE app.ts:42</text>
</svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
const f = path.join(os.tmpdir(), `clipe2e-${process.pid}.png`);
await fs.writeFile(f, png);

// 2. put it on the clipboard (Windows)
const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $i=[System.Drawing.Image]::FromFile('${f}'); [System.Windows.Forms.Clipboard]::SetImage($i); $i.Dispose(); 'SET'`;
await new Promise((res, rej) => {
  const p = spawn("powershell", ["-sta", "-NoProfile", "-Command", ps]);
  let o = "";
  p.stdout.on("data", (d) => (o += d));
  p.stderr.on("data", (d) => (o += d));
  p.on("close", (c) => (c === 0 ? res() : rej(new Error("set clipboard: " + o))));
});
console.log("clipboard set with error screenshot");

// 3. drive the MCP with image="clipboard" (host never sees the image)
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, VISION_API_KEY: KEY, VISION_BASE_URL: BASE, VISION_MODEL: MODEL, VISION_PROFILE: PROFILE },
});
const client = new Client({ name: "clip-e2e", version: "0.0.0" });
await client.connect(transport);
const r = await client.callTool(
  { name: "image_analysis", arguments: { image: "clipboard", detail_level: "overview", question: "这是什么界面？把红框里的报错逐字读出来" } },
  undefined,
  { timeout: 120000 },
);
console.log("isError:", !!r.isError);
console.log((r.content?.[0]?.text || "").replace(/\s+/g, " ").slice(0, 400));
await client.close();
await fs.rm(f, { force: true }).catch(() => {});
