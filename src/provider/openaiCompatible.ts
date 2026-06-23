import type { Config } from "../config.js";
import { getProfile, type Profile } from "./profiles.js";
import type {
  Capabilities,
  ToolSpec,
  ToolTurn,
  VisionInput,
  VisionProvider,
  VisionResult,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;

interface ChatMessage {
  role: string;
  content: unknown;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
}

/**
 * One provider that speaks the OpenAI-compatible `/chat/completions` dialect.
 * A per-profile {@link Profile} absorbs the places real backends diverge
 * (reasoning toggles, native video, tool-calling), so GLM / Kimi / Qwen /
 * OpenAI / local vLLM are all just configuration.
 */
export class OpenAICompatibleProvider implements VisionProvider {
  private readonly profile: Profile;

  constructor(private readonly cfg: Config) {
    this.profile = getProfile(cfg.profile);
  }

  get name(): string {
    return this.profile.name;
  }

  get model(): string {
    return this.cfg.model;
  }

  get capabilities(): Capabilities {
    const o = this.cfg.overrides;
    return {
      video: o.video ?? this.profile.video.native,
      thinking: o.thinking ?? (this.profile.reasoning.defaultOn || !!this.profile.reasoning.enablePayload),
      toolCalling: o.toolCalling ?? this.profile.toolCalling,
      grounding: o.grounding ?? this.profile.grounding,
      maxImages: this.profile.maxImages,
    };
  }

  async analyze(input: VisionInput): Promise<VisionResult> {
    const data = await this.post(this.buildBody(input));
    const message = this.firstMessage(data);
    return {
      text: stripReasoning(extractText(message?.content)),
      meta: { provider: this.name, model: this.model },
    };
  }

  async analyzeWithTools(input: VisionInput, tools: ToolSpec[]): Promise<ToolTurn> {
    const body = this.buildBody(input);
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = "auto";

    const data = await this.post(body);
    const message = this.firstMessage(data);
    const toolCalls = (message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeJsonParse(tc.function.arguments),
    }));
    return {
      toolCalls,
      text: stripReasoning(extractText(message?.content)),
      meta: { provider: this.name, model: this.model },
    };
  }

  private buildBody(input: VisionInput): Record<string, unknown> {
    const content: unknown[] = [];
    for (const img of input.images) {
      const url = img.dataUri ?? img.url;
      if (url) content.push({ type: "image_url", image_url: { url } });
    }
    if (input.video) {
      const url = input.video.dataUri ?? input.video.url;
      const field = this.profile.video.fieldName; // e.g. "video_url"
      if (url) content.push({ type: field, [field]: { url } });
    }
    content.push({ type: "text", text: input.prompt });

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: "user", content }],
    };
    if (input.maxTokens != null) body.max_tokens = input.maxTokens;
    if (input.temperature != null) body.temperature = input.temperature;

    const wantThinking = input.thinking ?? this.profile.reasoning.defaultOn;
    if (this.capabilities.thinking) {
      if (wantThinking && this.profile.reasoning.enablePayload) {
        Object.assign(body, this.profile.reasoning.enablePayload);
      } else if (!wantThinking && this.profile.reasoning.disablePayload) {
        Object.assign(body, this.profile.reasoning.disablePayload);
      }
    }
    return body;
  }

  private async post(body: Record<string, unknown>): Promise<unknown> {
    if (!this.cfg.apiKey) {
      throw new Error("缺少 API key：请设置 VISION_API_KEY（或 Z_AI_API_KEY）。");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(`视觉后端请求失败（${this.cfg.baseUrl}）：${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 500);
      throw new Error(`视觉后端返回 ${res.status} ${res.statusText}：${snippet}`);
    }
    return res.json();
  }

  private firstMessage(data: unknown): ChatMessage | undefined {
    const choices = (data as { choices?: { message?: ChatMessage }[] })?.choices;
    return choices?.[0]?.message;
  }
}

/** OpenAI content can be a string or an array of typed parts. */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "",
      )
      .join("");
  }
  return "";
}

function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
