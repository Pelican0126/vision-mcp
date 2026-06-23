// Raw API probe: confirm vision behavior of a model against the OpenAI-compatible endpoint.
// Usage: KEY=... node scripts/probe.mjs <model> <text|image>
import sharp from "sharp";

const KEY = process.env.KEY;
const BASE = process.env.BASE || "https://api.z.ai/api/paas/v4";
const model = process.argv[2] || "glm-4.6v";
const mode = process.argv[3] || "image";

async function makeImg() {
  const svg = `<svg width="900" height="600" xmlns="http://www.w3.org/2000/svg">
    <rect width="900" height="600" fill="#1e1e2e"/>
    <text x="50" y="110" font-size="60" fill="#ffffff" font-family="sans-serif">Build Dashboard</text>
    <rect x="600" y="40" width="270" height="56" rx="6" fill="#3a1a1a" stroke="#ff5555"/>
    <text x="616" y="76" font-size="19" fill="#ff6b6b" font-family="monospace">ERR-4096: NPE app.ts:42</text>
    <rect x="80" y="380" width="80" height="160" fill="#89b4fa"/>
    <rect x="220" y="300" width="80" height="240" fill="#89b4fa"/>
    <rect x="360" y="440" width="80" height="100" fill="#89b4fa"/>
    <text x="80" y="565" font-size="22" fill="#cdd6f4" font-family="sans-serif">Q1    Q2    Q3</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const content =
  mode === "text"
    ? "Reply with exactly one word: ok"
    : [
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${(await makeImg()).toString("base64")}` },
        },
        { type: "text", text: "逐字读出这张图里所有文字（包括右上角红框里的小字），并说明图里有几根柱子。" },
      ];

const t0 = Date.now();
const res = await fetch(`${BASE}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({ model, messages: [{ role: "user", content }] }),
});
const ms = Date.now() - t0;
const text = await res.text();
console.log(`[${model}/${mode}] HTTP ${res.status} in ${ms}ms`);
try {
  const j = JSON.parse(text);
  const msg = j.choices?.[0]?.message;
  console.log("content:", JSON.stringify(msg?.content)?.slice(0, 1200));
  if (msg?.reasoning_content) console.log("reasoning_content present:", String(msg.reasoning_content).slice(0, 200));
  if (j.error) console.log("error:", JSON.stringify(j.error));
  console.log("usage:", JSON.stringify(j.usage));
} catch {
  console.log("raw:", text.slice(0, 1200));
}
