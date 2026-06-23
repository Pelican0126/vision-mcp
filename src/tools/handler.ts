import type { Config } from "../config.js";
import { navBudget, runZoomLoop } from "../core/zoomLoop.js";
import { loadMedia } from "../media/load.js";
import { toDataUri } from "../media/transform.js";
import { sampleFrames } from "../media/video.js";
import { buildPrompt, type PromptArgs } from "../prompts.js";
import type { VisionProvider } from "../provider/types.js";
import type { ToolDef } from "./definitions.js";

type Args = Record<string, unknown>;

/** The subset of the MCP handler `extra` we use to emit progress notifications. */
interface ToolExtra {
  _meta?: { progressToken?: string | number };
  sendNotification?: (n: { method: string; params: Record<string, unknown> }) => Promise<void>;
}

/** Build a progress callback if the client requested progress (has a token). */
function makeProgress(extra?: ToolExtra) {
  const token = extra?._meta?.progressToken;
  const send = extra?.sendNotification;
  if (token == null || typeof send !== "function") return undefined;
  return async (p: { round: number; total: number; message: string }) => {
    try {
      await send({
        method: "notifications/progress",
        params: { progressToken: token, progress: p.round, total: p.total, message: p.message },
      });
    } catch {
      /* progress is best-effort */
    }
  };
}

interface ResultMeta {
  rounds: number;
  warnings: string[];
  confidence?: number;
  regions?: { box: number[]; note?: string }[];
}

/** Build the MCP tool handler for one tool. */
export function makeHandler(def: ToolDef, provider: VisionProvider, cfg: Config) {
  return async (args: Args, extra?: ToolExtra) => {
    try {
      const warnings: string[] = [];
      const detail = typeof args.detail_level === "string" ? args.detail_level : "auto";
      const thinking = typeof args.thinking === "boolean" ? args.thinking : def.defaultThinking;

      const promptArgs: PromptArgs = {
        question: optStr(args.question),
        extra: {
          target: optStr(args.target),
          framework: optStr(args.framework),
          lang_hint: optStr(args.lang_hint),
          code_context: optStr(args.code_context),
          focus: optStr(args.focus),
        },
      };
      const prompt = buildPrompt(def.promptKey, promptArgs);
      const navHint = optStr(args.question) ?? `定位并放大到能完成「${def.title}」所需的区域`;

      // ── single image: may run the agentic zoom loop ──────────────────────
      if (def.media === "image") {
        const m = await loadMedia(String(args.image), cfg);
        if (detail !== "overview" && m.original) {
          const zr = await runZoomLoop({
            provider,
            original: m.original,
            taskPrompt: prompt,
            navHint,
            maxRounds: navBudget(detail, cfg.maxZoomRounds),
            maxEdgePx: cfg.maxEdgePx,
            thinking,
            onProgress: makeProgress(extra),
          });
          return success(zr.text, provider, {
            rounds: zr.rounds,
            warnings: [...warnings, ...zr.warnings],
            confidence: zr.confidence,
            regions: zr.regions,
          });
        }
        if (detail !== "overview" && !m.original) {
          warnings.push("URL 透传无字节、无法裁切，已退化为单次。");
        }
        const r = await provider.analyze({ images: [m.overviewRef], prompt, thinking });
        return success(r.text, provider, { rounds: 1, warnings });
      }

      // ── two images (diff): single-pass in v1 ─────────────────────────────
      if (def.media === "twoImages") {
        if (detail !== "overview") warnings.push("ui_diff_check 暂不支持自动缩放，按单次处理。");
        const a = await loadMedia(String(args.image_a), cfg);
        const b = await loadMedia(String(args.image_b), cfg);
        const r = await provider.analyze({ images: [a.overviewRef, b.overviewRef], prompt, thinking });
        return success(r.text, provider, { rounds: 1, warnings });
      }

      // ── video: native if supported, else universal ffmpeg frame-sampling ──
      const m = await loadMedia(String(args.video), cfg);
      if (provider.capabilities.video) {
        const r = await provider.analyze({ images: [], video: m.overviewRef, prompt, thinking });
        return success(r.text, provider, { rounds: 1, warnings });
      }
      if (!m.original) {
        warnings.push("URL 透传无字节，无法帧采样；请关闭透传或配置原生视频后端。");
        return success(VIDEO_UNSUPPORTED, provider, { rounds: 0, warnings });
      }
      try {
        const frames = await sampleFrames(m.original, cfg.videoFrames, cfg.maxEdgePx);
        warnings.push(`后端无原生视频能力：已抽取 ${frames.length} 帧作为多图分析。`);
        const images = frames.map((f) => ({ dataUri: toDataUri(f, "image/png") }));
        const r = await provider.analyze({ images, prompt, thinking });
        return success(r.text, provider, { rounds: 1, warnings });
      } catch (e) {
        return success(VIDEO_UNSUPPORTED, provider, {
          rounds: 0,
          warnings: [...warnings, (e as Error).message],
        });
      }
    } catch (err) {
      return failure(provider, (err as Error).message);
    }
  };
}

const VIDEO_UNSUPPORTED =
  "## 时序概述\n当前视觉后端不支持原生视频理解。\n\n## 关键事件\n看不清（无视频能力）。\n\n" +
  "## 回答\n请配置支持视频的后端（如 GLM/Kimi），或等待帧采样支持（后续版本）。";

function success(markdown: string, provider: VisionProvider, meta: ResultMeta) {
  return {
    content: [{ type: "text" as const, text: markdown }],
    structuredContent: {
      markdown,
      ...(meta.confidence != null ? { confidence: meta.confidence } : {}),
      rounds: meta.rounds,
      ...(meta.regions ? { regions: meta.regions } : {}),
      warnings: meta.warnings,
      provider: provider.name,
      model: provider.model,
    },
  };
}

function failure(provider: VisionProvider, message: string) {
  const text = `❌ ${message}`;
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: {
      markdown: text,
      rounds: 0,
      warnings: [message],
      provider: provider.name,
      model: provider.model,
    },
    isError: true,
  };
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}
