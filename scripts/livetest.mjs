// Live end-to-end test through the real MCP server against a real backend.
// Usage: KEY=... [MODEL=mimo-v2.5] [PROFILE=generic] node scripts/livetest.mjs
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

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vmlive-"));
const png = async (svg, file) => {
  await fs.writeFile(path.join(dir, file), await sharp(Buffer.from(svg)).png().toBuffer());
  return path.join(dir, file);
};

const dashboard = await png(
  `<svg width="900" height="600" xmlns="http://www.w3.org/2000/svg">
    <rect width="900" height="600" fill="#1e1e2e"/>
    <text x="50" y="110" font-size="60" fill="#fff" font-family="sans-serif">Build Dashboard</text>
    <rect x="600" y="40" width="270" height="56" rx="6" fill="#3a1a1a" stroke="#ff5555"/>
    <text x="616" y="76" font-size="19" fill="#ff6b6b" font-family="monospace">ERR-4096: NPE app.ts:42</text>
    <rect x="80" y="380" width="80" height="160" fill="#89b4fa"/>
    <rect x="220" y="300" width="80" height="240" fill="#89b4fa"/>
    <rect x="360" y="440" width="80" height="100" fill="#89b4fa"/>
    <text x="80" y="565" font-size="22" fill="#cdd6f4" font-family="sans-serif">Q1    Q2    Q3</text>
  </svg>`,
  "dashboard.png",
);

// large image with a TINY code in the bottom-right → overview can't read it, zoom should
const big = await png(
  `<svg width="3600" height="2200" xmlns="http://www.w3.org/2000/svg">
    <rect width="3600" height="2200" fill="#11131a"/>
    <text x="120" y="220" font-size="120" fill="#fff" font-family="sans-serif">System Status: OK</text>
    <text x="3120" y="2160" font-size="15" fill="#a6e3a1" font-family="monospace">KEY: ZX-7741-Q</text>
  </svg>`,
  "big.png",
);

const chartA = await png(
  `<svg width="700" height="500" xmlns="http://www.w3.org/2000/svg">
    <rect width="700" height="500" fill="#ffffff"/>
    <rect x="100" y="350" width="90" height="100" fill="#4c8bf5"/>
    <rect x="260" y="250" width="90" height="200" fill="#4c8bf5"/>
    <rect x="420" y="300" width="90" height="150" fill="#4c8bf5"/>
    <text x="100" y="480" font-size="22" fill="#333">Q1   Q2   Q3</text>
  </svg>`,
  "chartA.png",
);
const chartB = await png(
  `<svg width="700" height="500" xmlns="http://www.w3.org/2000/svg">
    <rect width="700" height="500" fill="#ffffff"/>
    <rect x="100" y="350" width="90" height="100" fill="#4c8bf5"/>
    <rect x="260" y="250" width="90" height="200" fill="#4c8bf5"/>
    <rect x="420" y="170" width="90" height="280" fill="#4c8bf5"/>
    <rect x="580" y="320" width="90" height="130" fill="#e0485a"/>
    <text x="100" y="480" font-size="22" fill="#333">Q1   Q2   Q3   Q4</text>
  </svg>`,
  "chartB.png",
);
const diagram = await png(
  `<svg width="900" height="300" xmlns="http://www.w3.org/2000/svg">
    <rect width="900" height="300" fill="#fff"/>
    <rect x="40" y="110" width="180" height="80" fill="#e8f0fe" stroke="#4c8bf5"/>
    <text x="80" y="160" font-size="24" fill="#333">Client</text>
    <rect x="360" y="110" width="180" height="80" fill="#e8f0fe" stroke="#4c8bf5"/>
    <text x="410" y="160" font-size="24" fill="#333">API</text>
    <rect x="680" y="110" width="180" height="80" fill="#e8f0fe" stroke="#4c8bf5"/>
    <text x="730" y="160" font-size="24" fill="#333">DB</text>
    <line x1="220" y1="150" x2="360" y2="150" stroke="#333" stroke-width="3" marker-end="url(#a)"/>
    <line x1="540" y1="150" x2="680" y2="150" stroke="#333" stroke-width="3"/>
  </svg>`,
  "diagram.png",
);

const ff = (await import("ffmpeg-static")).default;
const clip = path.join(dir, "clip.mp4");
await new Promise((res, rej) => {
  const p = spawn(ff, ["-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=8", "-pix_fmt", "yuv420p", clip]);
  p.on("error", rej);
  p.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg " + c))));
});

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: {
    ...process.env,
    VISION_API_KEY: KEY,
    VISION_BASE_URL: BASE,
    VISION_MODEL: MODEL,
    VISION_PROFILE: PROFILE,
    VISION_ALLOWED_DIRS: dir,
    VISION_MAX_ZOOM_ROUNDS: "3",
  },
});
const client = new Client({ name: "live", version: "0.0.0" });
await client.connect(transport);
console.log(`\n=== LIVE TEST · model=${MODEL} profile=${PROFILE} ===`);

const TIMEOUT = Number(process.env.TIMEOUT) || 120000;
const ONLY = process.env.ONLY;

async function call(name, args, label) {
  if (ONLY && !label.includes(ONLY)) return;
  const t0 = Date.now();
  try {
    const r = await client.callTool({ name, arguments: args }, undefined, {
      timeout: TIMEOUT,
      resetTimeoutOnProgress: true,
      onprogress: (p) => console.log(`   ↳ progress ${p.progress}/${p.total} ${p.message ?? ""}`),
    });
    const ms = Date.now() - t0;
    const sc = r.structuredContent || {};
    const md = (r.content?.[0]?.text || "").replace(/\s+/g, " ").slice(0, 360);
    console.log(
      `\n### ${label} [${name}] ${ms}ms isError=${!!r.isError} rounds=${sc.rounds} regions=${(sc.regions || []).map((x) => x.note).join(",")} warn=${JSON.stringify(sc.warnings)}`,
    );
    console.log("   ", md);
  } catch (e) {
    console.log(`\n### ${label} [${name}] THREW: ${e.message}`);
  }
}

await call("image_analysis", { image: dashboard, detail_level: "overview", question: "这是什么界面？有几根柱子？" }, "通用-overview");
await call("extract_text_from_screenshot", { image: dashboard, detail_level: "overview" }, "OCR");
await call("diagnose_error_screenshot", { image: dashboard, detail_level: "overview" }, "诊断");
await call("analyze_data_visualization", { image: chartA, detail_level: "overview" }, "图表读数");
await call("understand_technical_diagram", { image: diagram, detail_level: "overview" }, "技术图");
await call("ui_to_artifact", { image: dashboard, target: "spec", detail_level: "overview" }, "UI转规格");
await call("ui_diff_check", { image_a: chartA, image_b: chartB }, "UI对比");
await call("extract_text_from_screenshot", { image: big, detail_level: "overview", question: "读出右下角的小密钥码" }, "大图-overview(对照)");
await call("extract_text_from_screenshot", { image: big, detail_level: "fine", question: "读出右下角的小密钥码" }, "大图-fine(缩放)");
await call("video_analysis", { video: clip, question: "视频画面里是什么？" }, "视频帧采样");

await client.close();
await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
console.log("\n=== DONE ===");
