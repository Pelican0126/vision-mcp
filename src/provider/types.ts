/** A single image reference passed to the vision backend. */
export interface VisionImageRef {
  /** `data:<mime>;base64,...` data URI. */
  dataUri?: string;
  /** Remote URL (only used when URL passthrough is enabled). */
  url?: string;
}

/** What a provider needs to answer one question about some images. */
export interface VisionInput {
  images: VisionImageRef[];
  /** Optional native video part (only used when the profile supports it). */
  video?: VisionImageRef;
  prompt: string;
  /** Tri-state: true = force reasoning on, false = force off, undefined = provider default. */
  thinking?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface ProviderMeta {
  provider: string;
  model: string;
}

export interface VisionResult {
  text: string;
  meta: ProviderMeta;
}

/** Capabilities of a configured backend (profile defaults ∘ env overrides). */
export interface Capabilities {
  video: boolean;
  thinking: boolean;
  toolCalling: boolean;
  grounding: boolean;
  maxImages: number;
}

/** A function/tool the model may call during the agentic zoom loop (P3). */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: Record<string, unknown>;
}

/** One turn of a tool-calling exchange. */
export interface ToolTurn {
  /** Tool calls the model requested this turn (empty if it answered directly). */
  toolCalls: { id: string; name: string; arguments: unknown }[];
  /** Free text the model produced this turn (may be empty when it called tools). */
  text: string;
  meta: ProviderMeta;
}

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  readonly capabilities: Capabilities;
  analyze(input: VisionInput): Promise<VisionResult>;
  /** Optional native function-calling round, used by the zoom loop when supported. */
  analyzeWithTools?(input: VisionInput, tools: ToolSpec[]): Promise<ToolTurn>;
}
