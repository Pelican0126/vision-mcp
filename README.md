# vision-mcp

> Give **eyes** to any "blind" coding agent — a local MCP server that lets text-only models see screenshots, error images, design mockups and video.
>
> 给所有**看不见图**的编码 agent 装上眼睛 —— 一个本地 MCP 服务，让纯文本模型也能看懂截图、报错图、设计稿和视频。

**English** · [中文](#中文)

It hands images to a vision model "out of band" and returns **text + machine-readable metadata** to the host, so a host that can't see images (GLM coding model, DeepSeek, Qwen-coder, local models…) effectively gains sight. Works with **any OpenAI-compatible vision backend** (GLM / Kimi / Xiaomi MiMo / OpenAI / local vLLM), and adds **server-led agentic zoom** to read details that downsampling would otherwise lose.

---

## English

### Features

- **8 task-specific tools**: UI→code, OCR, error diagnosis, diagram understanding, chart reading, UI diff, generic image, video.
- **Any OpenAI-compatible backend** via one provider + per-backend profile. Switch with 3 env vars. GLM by default.
- **Agentic auto-zoom**: server crops & upscales coarse→fine (grid → grounding → precise crop) from the *full-resolution* original, so tiny text becomes legible. Verified to fix hallucination on small detail (see [Verified](#verified-live)).
- **Universal video**: backends without native video automatically get ffmpeg frame-sampling → multi-image.
- **Dual output**: `content` (structured markdown) **+** `structuredContent` (confidence / regions / rounds / warnings / provider / model).
- **Safe by default**: local-path allowlist, URL download + SSRF check (no blind passthrough), magic-byte validation, size caps.

### How it works (30-second mental model)

```
host tool(image, detail_level)
  → validate + load media (full-res original + downsampled overview; path allowlist; URL SSRF)
  → overview ? single pass : zoomLoop (deterministic grid → model votes/grounding → crop original → early-exit)
  → content(markdown) + structuredContent(metadata)
```

The vision model is a "consultant" hired for one question; only its **text answer** comes back to the host. Crops always come from the full-resolution original (never the downsampled overview), so zoom actually recovers detail.

### Quick start

**1. Install & build** (Node ≥ 20)

```bash
npm install
npm run build
```

**2. Pick a backend.** Default is GLM (z.ai). Any OpenAI-compatible `/chat/completions` endpoint with `image_url` support works — set 3 env vars:

```bash
export VISION_API_KEY=your_key
export VISION_BASE_URL=https://api.z.ai/api/paas/v4
export VISION_MODEL=glm-4.6v
```

**3. Connect your MCP client** (zcode / Cline / Cursor / Claude Desktop …). Add to its `mcpServers` config:

```json
{
  "mcpServers": {
    "vision": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH>/dist/index.js"],
      "env": {
        "VISION_API_KEY": "your_key",
        "VISION_BASE_URL": "https://api.z.ai/api/paas/v4",
        "VISION_MODEL": "glm-4.6v",
        "VISION_ALLOWED_DIRS": "<ABSOLUTE_PATH_TO_YOUR_PROJECT>"
      }
    }
  }
}
```

> **Timeout**: reasoning vision models are slow (code/spec generation can take 30–60s+). Set your host's MCP tool timeout generously (≥120s). During deep zoom the server emits `notifications/progress`, so clients that honor `resetTimeoutOnProgress` stay alive.

### Usage tutorial

The host is a text-only agent — it never sees the image. You tell the agent where the image is (a path under `VISION_ALLOWED_DIRS`, or a URL / data URI) and which tool to use; the agent calls the tool, the server returns text, the agent continues.

**Example 1 — diagnose an error screenshot**

1. Save your screenshot at e.g. `./screenshots/error.png` (inside an allowed dir).
2. Ask your agent: *"Use the vision MCP `diagnose_error_screenshot` on `./screenshots/error.png`."*
3. The tool returns markdown sections `## Root cause / ## Verbatim error / ## Location / ## Fix steps`, and the agent uses it to write the fix.

**Example 2 — read a tiny detail (agentic zoom)**

For small text the model can't read at a glance, pass `detail_level: "fine"`:

```jsonc
// the call your agent makes
{ "name": "extract_text_from_screenshot",
  "arguments": { "image": "./screenshots/big.png", "detail_level": "fine",
                 "question": "read the small key code in the bottom-right corner" } }
```

The server runs the zoom loop: it grids the image, the model votes which region matters, the server crops that region from the original and re-reads it — recovering text that a single overview pass would misread. `structuredContent.regions` shows where it looked, `rounds` how many passes it took.

**`detail_level`** values: `overview` (single fast pass) · `normal` · `fine` (deep zoom) · `auto` (default — zooms only when needed, early-exits when clear).

**Example 3 — analyze a video**

```jsonc
{ "name": "video_analysis",
  "arguments": { "video": "./clips/repro.mp4", "question": "what bug is shown?" } }
```

If the backend has no native video, the server samples frames with ffmpeg and analyzes them as images — so video works on any vision backend.

**Quick local test (no client needed)** — the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
# then set the env vars in the Inspector UI and call any tool
```

Or run the bundled scripts: `node scripts/smoke.mjs` (lists tools), `KEY=... node scripts/livetest.mjs` (drives all 8 tools end-to-end).

### Tools

| Tool | Purpose |
|---|---|
| `ui_to_artifact` | UI screenshot → code / spec |
| `extract_text_from_screenshot` | verbatim OCR |
| `diagnose_error_screenshot` | error diagnosis (root cause / verbatim / location / fix) |
| `understand_technical_diagram` | architecture / flow / UML / ER / sequence diagrams |
| `analyze_data_visualization` | read charts / dashboards |
| `ui_diff_check` | compare two UI screenshots |
| `image_analysis` | generic image understanding (fallback) |
| `video_analysis` | video understanding (native or frame-sampled) |

Common params: `detail_level`, `question`, `region`, `thinking`.

### Backends

| Backend | `VISION_PROFILE` | `VISION_BASE_URL` | `VISION_MODEL` |
|---|---|---|---|
| GLM (z.ai) | `glm` | `https://api.z.ai/api/paas/v4` | `glm-4.6v` |
| Kimi (Moonshot) | `kimi` | `https://api.moonshot.ai/v1` | `<kimi vision model>` |
| Xiaomi MiMo | `mimo` | `<your endpoint>/v1` | `mimo-v2.5` (vision build) |
| OpenAI | `openai` | `https://api.openai.com/v1` | `gpt-4o` |
| local vLLM/Ollama | `generic` | `http://localhost:8000/v1` | `<local VLM>` |

> Any OpenAI-compatible endpoint with `image_url` support works with `generic`.

### Configuration (env)

| Var | Default | Notes |
|---|---|---|
| `VISION_API_KEY` (alias `Z_AI_API_KEY`) | — required | backend key |
| `VISION_PROFILE` | `glm` | `glm` / `kimi` / `mimo` / `openai` / `generic` |
| `VISION_BASE_URL` | per profile | OpenAI-compatible endpoint |
| `VISION_MODEL` | per profile | vision model id |
| `VISION_ALLOWED_DIRS` | cwd | dirs allowed for local image paths (`;`/`:` separated) |
| `VISION_ALLOW_URL_PASSTHROUGH` | `false` | forward image URLs to the backend (default: download + SSRF-check → data URI) |
| `VISION_MAX_ZOOM_ROUNDS` | `3` | max agentic zoom rounds |
| `VISION_MAX_EDGE_PX` | `1568` | overview downsample longest edge |
| `VISION_VIDEO_FRAMES` | `8` | frames sampled per video |
| `VISION_MAX_IMAGE_MB` / `_VIDEO_MB` | `10` / `50` | size caps |

### Verified live

Tested against **Xiaomi MiMo** (`mimo-v2.5` vision / `mimo-v2.5-pro` blind):

- All 8 tools work end-to-end.
- **Agentic zoom proven**: a tiny key code in a corner — `overview` *hallucinated* it (`REV: 2A-74A1-0`); `detail_level=fine` navigated to the bottom-right and read the correct `KEY: ZX-7741-Q` consistently across re-runs.
- **Video frame-sampling**: mimo has no native video → auto frame-sampling succeeded.
- **Blind model degrades gracefully**: `mimo-v2.5-pro` returns `404 No endpoints found that support image input` → tool returns `isError` + a clear message, no crash.

Reproduce: `KEY=... PROFILE=mimo MODEL=mimo-v2.5 BASE=<endpoint>/v1 node scripts/livetest.mjs`.

### Privacy

Your images/video are sent to the configured backend API. Don't use untrusted backends for sensitive content; a local deployment (`generic` profile → local vLLM) keeps data on your machine.

### Development

```bash
npm run dev    # run source via tsx
npm run build  # tsc → dist/
npm test       # vitest, fully offline (no API key) — 33 tests
```

Tests cover the zoom state machine (early-exit / budget / parse-fail / out-of-bounds / grounding / tool-calling), media security (magic-bytes / path traversal / SSRF / downscale), tool schemas, and video frame sampling.

### Architecture

`src/`: `provider/` (OpenAI-compatible client + profiles), `core/zoomLoop.ts`, `media/` (load / transform / security / video), `tools/`, `prompts.ts`.

---

## 中文

让纯文本模型也能「看见」：把图交给视觉模型「带外」分析，只把**文字结论 + 机器可读元数据**回传宿主。支持**任何 OpenAI 兼容的视觉后端**（GLM / Kimi / 小米 MiMo / OpenAI / 本地 vLLM），并用 **server 主导的 agentic 缩放**读出降采样会丢失的细节。

### 特性

- **8 个任务专用工具**：UI 转代码、OCR、报错诊断、技术图理解、图表读数、UI 对比、通用图像、视频理解。
- **多后端**：一个 provider + per-backend profile，改 3 个 env 即切换，GLM 默认。
- **Agentic 自动缩放**：从**全分辨率原图**由粗到细裁切放大（九宫格 → grounding → 精确裁切），让小字可读；已实测能修正小细节上的幻觉（见[已联机验证](#已联机验证)）。
- **视频通用**：无原生视频能力的后端自动走 ffmpeg 帧采样 → 多图分析。
- **双输出**：`content`（结构化 markdown）+ `structuredContent`（confidence / regions / rounds / warnings / provider / model）。
- **默认安全**：本地路径白名单、URL 默认下载 + SSRF 校验（不透传）、magic-bytes 校验、大小上限。

### 工作原理（30 秒心智模型）

```
宿主 tool(image, detail_level)
  → 校验 + 载媒体（全分辨率原图 + 降采样概览图；路径白名单；URL SSRF）
  → overview ? 单次 : zoomLoop（确定性网格 → 模型投票/grounding → 裁原图 → 早退）
  → content(markdown) + structuredContent(元数据)
```

视觉模型是为「一个问题」临时请来的顾问，只有它的**文字答案**回到宿主。裁切始终从全分辨率原图取（不是降采样图），所以缩放才能真正找回细节。

### 快速上手

**1. 安装构建**（Node ≥ 20）

```bash
npm install
npm run build
```

**2. 选后端**。默认 GLM（z.ai）。任何支持 `image_url` 的 OpenAI 兼容端点都行，设 3 个 env：

```bash
export VISION_API_KEY=你的key
export VISION_BASE_URL=https://api.z.ai/api/paas/v4
export VISION_MODEL=glm-4.6v
```

**3. 接入 MCP 客户端**（zcode / Cline / Cursor / Claude Desktop……），在其 `mcpServers` 配置里加：

```json
{
  "mcpServers": {
    "vision": {
      "command": "node",
      "args": ["<绝对路径>/dist/index.js"],
      "env": {
        "VISION_API_KEY": "你的key",
        "VISION_BASE_URL": "https://api.z.ai/api/paas/v4",
        "VISION_MODEL": "glm-4.6v",
        "VISION_ALLOWED_DIRS": "<你的项目绝对路径>"
      }
    }
  }
}
```

> **超时**：推理型视觉模型较慢（生成代码/规格可能 30–60s+）。把宿主的 MCP 工具超时设宽松些（≥120s）。深度缩放期间 server 会发 `notifications/progress`，支持 `resetTimeoutOnProgress` 的客户端可借此保活。

### 使用教程

宿主是纯文本 agent，永远看不到图。你告诉它图在哪（`VISION_ALLOWED_DIRS` 下的路径，或 URL / data URI）、用哪个工具；agent 调用工具，server 回文字，agent 继续干活。

**例 1 — 诊断报错截图**

1. 把截图存到 `./screenshots/error.png`（在允许目录内）。
2. 对 agent 说：*「用 vision MCP 的 `diagnose_error_screenshot` 分析 `./screenshots/error.png`」*。
3. 工具返回 `## 根因 / ## 错误原文 / ## 位置 / ## 修复步骤`，agent 据此写修复。

**例 2 — 读小细节（agentic 缩放）**

模型一眼读不清的小字，传 `detail_level: "fine"`：

```jsonc
{ "name": "extract_text_from_screenshot",
  "arguments": { "image": "./screenshots/big.png", "detail_level": "fine",
                 "question": "读出右下角的小密钥码" } }
```

server 跑缩放循环：把图划网格 → 模型投票哪块相关 → 从原图裁该块重读，找回单次概览会读错的文字。`structuredContent.regions` 显示它看了哪、`rounds` 显示用了几轮。

**`detail_level`** 取值：`overview`（单次快速）·`normal`·`fine`（深度缩放）·`auto`（默认，需要才缩放、清晰则早退）。

**例 3 — 分析视频**

```jsonc
{ "name": "video_analysis",
  "arguments": { "video": "./clips/repro.mp4", "question": "视频里是什么 bug？" } }
```

后端无原生视频时，server 用 ffmpeg 抽帧当多图分析 —— 任意视觉后端都能处理视频。

**本地快测（无需客户端）** —— MCP Inspector：

```bash
npx @modelcontextprotocol/inspector node dist/index.js
# 在 Inspector 界面里填好 env，点任意工具
```

或用自带脚本：`node scripts/smoke.mjs`（列工具）、`KEY=... node scripts/livetest.mjs`（全 8 工具端到端）。

### 工具

| 工具 | 用途 |
|---|---|
| `ui_to_artifact` | UI 截图 → 代码 / 规格 |
| `extract_text_from_screenshot` | 逐字 OCR |
| `diagnose_error_screenshot` | 报错诊断（根因/原文/位置/修复） |
| `understand_technical_diagram` | 架构/流程/UML/ER/时序图 |
| `analyze_data_visualization` | 图表/仪表盘读数 |
| `ui_diff_check` | 两张 UI 截图对比 |
| `image_analysis` | 通用图像理解（兜底） |
| `video_analysis` | 视频理解（原生或帧采样） |

公共参数：`detail_level`、`question`、`region`、`thinking`。

### 后端

| 后端 | `VISION_PROFILE` | `VISION_BASE_URL` | `VISION_MODEL` |
|---|---|---|---|
| GLM (z.ai) | `glm` | `https://api.z.ai/api/paas/v4` | `glm-4.6v` |
| Kimi (Moonshot) | `kimi` | `https://api.moonshot.ai/v1` | `<kimi 视觉模型>` |
| 小米 MiMo | `mimo` | `<你的端点>/v1` | `mimo-v2.5`（视觉版） |
| OpenAI | `openai` | `https://api.openai.com/v1` | `gpt-4o` |
| 本地 vLLM/Ollama | `generic` | `http://localhost:8000/v1` | `<本地 VLM>` |

> 任何 OpenAI 兼容、支持 `image_url` 的端点都能用 `generic` 直接接入。

### 配置（env）

| 变量 | 默认 | 说明 |
|---|---|---|
| `VISION_API_KEY`（别名 `Z_AI_API_KEY`） | — 必填 | 后端 key |
| `VISION_PROFILE` | `glm` | `glm` / `kimi` / `mimo` / `openai` / `generic` |
| `VISION_BASE_URL` | 随 profile | OpenAI 兼容端点 |
| `VISION_MODEL` | 随 profile | 视觉模型 |
| `VISION_ALLOWED_DIRS` | 当前目录 | 允许读取本地图片的目录（`;`/`:` 分隔） |
| `VISION_ALLOW_URL_PASSTHROUGH` | `false` | 是否把图片 URL 直接透传给后端（默认下载+SSRF 校验后转 data URI） |
| `VISION_MAX_ZOOM_ROUNDS` | `3` | agentic 缩放最大轮数 |
| `VISION_MAX_EDGE_PX` | `1568` | 概览图降采样最大边长 |
| `VISION_VIDEO_FRAMES` | `8` | 每个视频抽帧数 |
| `VISION_MAX_IMAGE_MB` / `_VIDEO_MB` | `10` / `50` | 大小上限 |

### 已联机验证

针对 **小米 MiMo**（`mimo-v2.5` 视觉版 / `mimo-v2.5-pro` 盲版）实测：

- 8 个工具全部端到端跑通。
- **Agentic 缩放验证有效**：角落小密钥码，`overview` 单次会**编造**（`REV: 2A-74A1-0`）；`detail_level=fine` 导航到右下、复跑稳定读出正确的 `KEY: ZX-7741-Q`。
- **视频帧采样**：mimo 无原生视频 → 自动抽帧成功。
- **盲模型优雅降级**：`mimo-v2.5-pro` 返回 `404 No endpoints found that support image input` → 工具以 `isError` + 清晰提示返回，不崩溃。

复现：`KEY=... PROFILE=mimo MODEL=mimo-v2.5 BASE=<端点>/v1 node scripts/livetest.mjs`。

### 隐私

调用时图片/视频会发送到所配置的视觉后端 API。敏感内容请勿用不可信后端；本地部署（`generic` → 本地 vLLM）可避免数据外发。

### 开发

```bash
npm run dev    # tsx 直接跑源码
npm run build  # tsc → dist/
npm test       # vitest 离线测试（无需 key）—— 33 个用例
```

测试覆盖：缩放状态机（早退/预算/解析失败/越界/grounding/tool-calling）、媒体安全（magic-bytes/路径越界/SSRF/降采样）、工具 schema、视频帧采样。

### 架构

`src/`：`provider/`（OpenAI 兼容 + profile）、`core/zoomLoop.ts`、`media/`（load/transform/security/video）、`tools/`、`prompts.ts`。
