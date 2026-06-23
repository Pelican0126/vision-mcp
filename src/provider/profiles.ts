import type { ProfileName } from "../config.js";

/**
 * How a backend exposes reasoning/"thinking". This is the biggest place where
 * "OpenAI-compatible" backends actually diverge, so we capture it per profile.
 */
export interface ReasoningProfile {
  /** Whether the backend reasons by default with no extra params (e.g. Kimi). */
  defaultOn: boolean;
  /** Request-body fragment that turns reasoning ON (merged into the payload). */
  enablePayload?: Record<string, unknown>;
  /** Request-body fragment that turns reasoning OFF. */
  disablePayload?: Record<string, unknown>;
  /**
   * Response message fields carrying the reasoning trace, which we strip so the
   * host only ever sees the final answer. Inline `<think>…</think>` is always
   * stripped regardless.
   */
  outputFields: string[];
}

export interface VideoProfile {
  /** Whether the backend accepts native video (vs. our ffmpeg frame-sampling). */
  native: boolean;
  /** Content field name for native video parts (e.g. "video_url"). */
  fieldName: string;
}

export interface Profile {
  name: ProfileName;
  reasoning: ReasoningProfile;
  video: VideoProfile;
  toolCalling: boolean;
  grounding: boolean;
  maxImages: number;
}

const GLM: Profile = {
  name: "glm",
  reasoning: {
    defaultOn: false,
    enablePayload: { thinking: { type: "enabled" } },
    disablePayload: { thinking: { type: "disabled" } },
    outputFields: ["reasoning_content", "reasoning"],
  },
  video: { native: true, fieldName: "video_url" },
  toolCalling: true,
  grounding: true,
  maxImages: 8,
};

const KIMI: Profile = {
  name: "kimi",
  reasoning: {
    // Kimi vision (K2.x) reasons by default; turn it off explicitly.
    defaultOn: true,
    disablePayload: { thinking: { type: "disabled" } },
    outputFields: ["reasoning_content", "reasoning"],
  },
  video: { native: true, fieldName: "video_url" },
  toolCalling: true,
  grounding: false,
  maxImages: 8,
};

const MIMO: Profile = {
  name: "mimo",
  reasoning: {
    // Xiaomi MiMo reasons by default; the trace comes back in reasoning_content
    // (a separate field we drop). mimo-v2.5 sees images; mimo-v2.5-pro is blind.
    defaultOn: true,
    outputFields: ["reasoning_content", "reasoning"],
  },
  video: { native: false, fieldName: "video_url" },
  toolCalling: false,
  grounding: false,
  maxImages: 8,
};

const OPENAI: Profile = {
  name: "openai",
  reasoning: {
    defaultOn: false,
    outputFields: ["reasoning_content", "reasoning"],
  },
  video: { native: false, fieldName: "video_url" },
  toolCalling: true,
  grounding: false,
  maxImages: 8,
};

const GENERIC: Profile = {
  name: "generic",
  reasoning: {
    defaultOn: false,
    outputFields: ["reasoning_content", "reasoning"],
  },
  video: { native: false, fieldName: "video_url" },
  toolCalling: false,
  grounding: false,
  maxImages: 4,
};

const PROFILES: Record<ProfileName, Profile> = {
  glm: GLM,
  kimi: KIMI,
  mimo: MIMO,
  openai: OPENAI,
  generic: GENERIC,
};

export function getProfile(name: ProfileName): Profile {
  return PROFILES[name];
}
