import {
  clampBox,
  renderRegion,
  subdivide,
  toDataUri,
  type NormBox,
} from "../media/transform.js";
import { zoomControlPrompt, zoomToolPrompt } from "../prompts.js";
import type { ToolSpec, VisionImageRef, VisionProvider } from "../provider/types.js";

export interface ZoomResult {
  text: string;
  /** Total provider calls made (navigation rounds + the final structured read). */
  rounds: number;
  regions: { box: number[]; note?: string }[];
  confidence?: number;
  warnings: string[];
}

export interface ZoomAction {
  action: "zoom" | "done";
  region?: number;
  /** Optional grounding bbox, in the CURRENT view's normalized coords. */
  box?: NormBox;
  confidence?: number;
  answer?: string;
}

const LABELS_3 = ["左上", "上中", "右上", "左中", "正中", "右中", "左下", "下中", "右下"];

const ZOOM_TOOLS: ToolSpec[] = [
  {
    name: "zoom",
    description: "放大到一个候选区域或精确 bbox 以看清细节",
    parameters: {
      type: "object",
      properties: {
        region: { type: "integer", description: "候选区域编号 0-8" },
        box: { type: "array", items: { type: "number" }, description: "可选：当前视图内归一化 bbox [x,y,w,h]" },
        reason: { type: "string" },
      },
    },
  },
  {
    name: "done",
    description: "已能看清，给出最终答案",
    parameters: {
      type: "object",
      properties: {
        answer: { type: "string" },
        confidence: { type: "number" },
      },
    },
  },
];

export interface ZoomOptions {
  provider: VisionProvider;
  original: Buffer;
  /** Full structured prompt used for the final read on the focused region. */
  taskPrompt: string;
  /** Short hint of what to look for, used to steer navigation. */
  navHint: string;
  /** Max navigation rounds before the final read. */
  maxRounds: number;
  maxEdgePx: number;
  thinking: boolean;
  /** Optional keepalive hook called each round (drives MCP progress notifications). */
  onProgress?: (p: { round: number; total: number; message: string }) => void | Promise<void>;
}

/**
 * Server-led, deterministic-first agentic zoom. The server always subdivides the
 * current view into a fixed grid; the model only *votes* which cell is relevant
 * (or, when the backend declares grounding, returns a bbox we clamp). Crops are
 * always taken from the full-resolution original, never the downsampled overview.
 * Control path is the backend's declared capability: native tool-calling first,
 * JSON action protocol as the universal fallback.
 */
export async function runZoomLoop(opts: ZoomOptions): Promise<ZoomResult> {
  const { provider, original, taskPrompt, navHint, maxRounds, maxEdgePx, thinking, onProgress } = opts;
  const useTools = provider.capabilities.toolCalling && typeof provider.analyzeWithTools === "function";
  const grounding = provider.capabilities.grounding;
  const total = Math.max(1, maxRounds) + 1;
  const warnings: string[] = [];
  const regions: { box: number[]; note?: string }[] = [];
  let currentBox: NormBox = [0, 0, 1, 1];
  let calls = 0;
  let confidence: number | undefined;

  for (let r = 0; r < Math.max(1, maxRounds); r++) {
    await onProgress?.({ round: r + 1, total, message: `缩放导航第 ${r + 1} 轮` });
    const cells = subdivide(currentBox, 3);
    const view = await renderRegion(original, currentBox, maxEdgePx);
    const viewRef: VisionImageRef = { dataUri: toDataUri(view, "image/png") };
    calls++;
    const action = useTools
      ? await decideViaTools(provider, viewRef, navHint, thinking)
      : await decideViaJson(provider, viewRef, navHint, thinking);

    if (!action) {
      warnings.push(`第 ${r + 1} 轮无法解析缩放动作，停止缩放。`);
      break;
    }
    confidence = action.confidence ?? confidence;
    if (action.action === "done") break;

    if (grounding && action.box && action.box.length === 4) {
      currentBox = mapBoxIntoView(currentBox, action.box);
      regions.push({ box: [...currentBox], note: "grounding" });
      continue;
    }
    const idx = action.region;
    if (idx == null || idx < 0 || idx >= cells.length || !cells[idx]) {
      warnings.push(`第 ${r + 1} 轮返回越界/缺失区域(${idx ?? "无"})，停止缩放。`);
      break;
    }
    currentBox = cells[idx]!;
    regions.push({ box: [...currentBox], note: LABELS_3[idx] });
  }

  // Final structured read on the focused (zoomed) region using the full task prompt.
  await onProgress?.({ round: total, total, message: "最终读取" });
  const finalView = await renderRegion(original, currentBox, maxEdgePx);
  calls++;
  const final = await provider.analyze({
    images: [{ dataUri: toDataUri(finalView, "image/png") }],
    prompt: taskPrompt,
    thinking,
  });

  return { text: final.text, rounds: calls, regions, confidence, warnings };
}

async function decideViaJson(
  provider: VisionProvider,
  view: VisionImageRef,
  navHint: string,
  thinking: boolean,
): Promise<ZoomAction | null> {
  const resp = await provider.analyze({
    images: [view],
    prompt: zoomControlPrompt(LABELS_3.map((l, i) => `${i}:${l}`), navHint),
    thinking,
  });
  return parseAction(resp.text);
}

async function decideViaTools(
  provider: VisionProvider,
  view: VisionImageRef,
  navHint: string,
  thinking: boolean,
): Promise<ZoomAction | null> {
  const turn = await provider.analyzeWithTools!(
    { images: [view], prompt: zoomToolPrompt(LABELS_3.map((l, i) => `${i}:${l}`), navHint), thinking },
    ZOOM_TOOLS,
  );
  const call = turn.toolCalls[0];
  if (!call) return parseAction(turn.text) ?? { action: "done" };
  const a = (call.arguments ?? {}) as Record<string, unknown>;
  if (call.name === "done") {
    return { action: "done", confidence: num(a.confidence), answer: str(a.answer) };
  }
  return { action: "zoom", region: num(a.region), box: numBox(a.box), confidence: num(a.confidence) };
}

/** Extract the first JSON object from model text and validate it as an action. */
export function parseAction(text: string): ZoomAction | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o.action !== "zoom" && o.action !== "done") return null;
  return {
    action: o.action,
    region: num(o.region),
    box: numBox(o.box),
    confidence: num(o.confidence),
    answer: str(o.answer),
  };
}

/** Navigation-round budget by detail level. */
export function navBudget(detail: string, maxRounds: number): number {
  switch (detail) {
    case "normal":
      return 1;
    case "fine":
      return maxRounds;
    default: // auto
      return Math.min(2, maxRounds);
  }
}

/** Map a bbox given in the current view's coords into absolute image coords. */
function mapBoxIntoView([cx, cy, cw, ch]: NormBox, [bx, by, bw, bh]: NormBox): NormBox {
  return clampBox([cx + bx * cw, cy + by * ch, bw * cw, bh * ch]);
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function numBox(v: unknown): NormBox | undefined {
  if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number")) {
    return [v[0], v[1], v[2], v[3]] as NormBox;
  }
  return undefined;
}
