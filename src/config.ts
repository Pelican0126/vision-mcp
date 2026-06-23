import path from "node:path";

export type ProfileName = "glm" | "kimi" | "mimo" | "openai" | "generic";

export interface CapabilityOverrides {
  video?: boolean;
  thinking?: boolean;
  toolCalling?: boolean;
  grounding?: boolean;
}

export interface Config {
  apiKey: string;
  baseUrl: string;
  model: string;
  profile: ProfileName;
  allowedDirs: string[];
  allowUrlPassthrough: boolean;
  maxZoomRounds: number;
  maxEdgePx: number;
  videoFrames: number;
  maxImageBytes: number;
  maxVideoBytes: number;
  overrides: CapabilityOverrides;
}

const PROFILE_DEFAULT_BASE_URL: Record<ProfileName, string> = {
  glm: "https://api.z.ai/api/paas/v4",
  kimi: "https://api.moonshot.ai/v1",
  mimo: "", // Xiaomi MiMo: endpoint is deployment-specific, set VISION_BASE_URL
  openai: "https://api.openai.com/v1",
  generic: "",
};

const PROFILE_DEFAULT_MODEL: Record<ProfileName, string> = {
  glm: "glm-4.6v",
  kimi: "moonshot-v1-8k-vision-preview",
  mimo: "mimo-v2.5",
  openai: "gpt-4o",
  generic: "",
};

function str(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name];
  return v != null && v.trim() !== "" ? v.trim() : undefined;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = str(env, name);
  if (v == null) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const v = str(env, name);
  if (v == null) return undefined;
  return /^(1|true|yes|on)$/i.test(v);
}

function parseProfile(raw: string | undefined): ProfileName {
  switch ((raw ?? "glm").toLowerCase()) {
    case "kimi":
      return "kimi";
    case "mimo":
      return "mimo";
    case "openai":
      return "openai";
    case "generic":
      return "generic";
    default:
      return "glm";
  }
}

/**
 * Build the runtime Config from environment variables. Never throws — a missing
 * API key surfaces later as a clear provider error, so tests can construct a
 * Config without credentials.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const profile = parseProfile(str(env, "VISION_PROFILE"));

  const allowedDirsRaw = str(env, "VISION_ALLOWED_DIRS");
  const allowedDirs = allowedDirsRaw
    ? allowedDirsRaw
        .split(path.delimiter)
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => path.resolve(d))
    : [process.cwd()];

  return {
    apiKey: str(env, "VISION_API_KEY") ?? str(env, "Z_AI_API_KEY") ?? "",
    baseUrl: (str(env, "VISION_BASE_URL") ?? PROFILE_DEFAULT_BASE_URL[profile]).replace(/\/+$/, ""),
    model: str(env, "VISION_MODEL") ?? PROFILE_DEFAULT_MODEL[profile],
    profile,
    allowedDirs,
    allowUrlPassthrough: bool(env, "VISION_ALLOW_URL_PASSTHROUGH") ?? false,
    maxZoomRounds: int(env, "VISION_MAX_ZOOM_ROUNDS", 3),
    maxEdgePx: int(env, "VISION_MAX_EDGE_PX", 1568),
    videoFrames: int(env, "VISION_VIDEO_FRAMES", 8),
    maxImageBytes: int(env, "VISION_MAX_IMAGE_MB", 10) * 1024 * 1024,
    maxVideoBytes: int(env, "VISION_MAX_VIDEO_MB", 50) * 1024 * 1024,
    overrides: {
      video: bool(env, "VISION_SUPPORTS_VIDEO"),
      thinking: bool(env, "VISION_SUPPORTS_THINKING"),
      toolCalling: bool(env, "VISION_SUPPORTS_TOOLCALLING"),
      grounding: bool(env, "VISION_SUPPORTS_GROUNDING"),
    },
  };
}
