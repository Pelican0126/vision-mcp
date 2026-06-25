import { z, type ZodRawShape } from "zod";
import type { PromptKey } from "../prompts.js";

export type MediaKind = "image" | "twoImages" | "video";

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputShape: ZodRawShape;
  outputShape: ZodRawShape;
  promptKey: PromptKey;
  media: MediaKind;
  /** Default reasoning intent for this tool (overridable per call). */
  defaultThinking: boolean;
}

const detailLevel = z
  .enum(["overview", "normal", "fine", "auto"])
  .optional()
  .describe("细节级别：overview=单次快速；normal/fine/auto 触发由粗到细的自动缩放（auto 为默认，足够清晰则早退）");

const common = {
  question: z.string().optional().describe("具体问题或额外要求"),
  detail_level: detailLevel,
  region: z
    .string()
    .optional()
    .describe("可选：手动指定关注区域，命名如 'top-right' 或归一化 bbox 'x,y,w,h'（0~1）"),
  thinking: z.boolean().optional().describe("是否开启视觉模型深度推理（默认按工具/后端策略）"),
};

const imageField = {
  image: z
    .string()
    .describe(
      "图片：本地路径 / file:// / http(s):// / data: URI / 'clipboard'（读系统剪贴板，文本宿主推荐）/ 'latest'（VISION_DROP_DIR 里最新图）",
    ),
};

const OUTPUT_SHAPE: ZodRawShape = {
  markdown: z.string().describe("人类可读的结构化 markdown 正文（与 content 一致）"),
  confidence: z.number().min(0).max(1).optional().describe("模型对结果的置信度"),
  rounds: z.number().int().nonnegative().describe("实际经历的视觉调用轮数"),
  regions: z
    .array(z.object({ box: z.array(z.number()), note: z.string().optional() }))
    .optional()
    .describe("缩放走过的区域轨迹（归一化 bbox）"),
  warnings: z.array(z.string()).describe("降级/截断/不确定等告警"),
  provider: z.string(),
  model: z.string(),
};

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "ui_to_artifact",
    title: "UI 截图转代码/规格",
    description:
      "把一张 UI 截图/设计稿转成可运行代码或结构化规格。当宿主拿到界面图、需要据此生成或还原前端实现时使用。",
    inputShape: {
      ...imageField,
      target: z.enum(["code", "spec"]).optional().describe("产出 code（默认）或 spec"),
      framework: z.string().optional().describe("目标框架，如 react/vue/html"),
      ...common,
    },
    outputShape: OUTPUT_SHAPE,
    promptKey: "ui_to_artifact",
    media: "image",
    defaultThinking: true,
  },
  {
    name: "extract_text_from_screenshot",
    title: "截图 OCR",
    description: "逐字提取截图中的文本（代码、终端、报错、文档等），保留阅读顺序与布局。需要把图里的文字读出来时使用。",
    inputShape: {
      ...imageField,
      lang_hint: z.string().optional().describe("语言/区域提示，如 'zh'、'代码'"),
      ...common,
    },
    outputShape: OUTPUT_SHAPE,
    promptKey: "extract_text_from_screenshot",
    media: "image",
    defaultThinking: false,
  },
  {
    name: "diagnose_error_screenshot",
    title: "报错截图诊断",
    description: "分析报错/异常截图，给出根因、逐字错误原文、位置和可执行的修复步骤。处理崩溃/红屏/堆栈截图时使用。",
    inputShape: {
      ...imageField,
      code_context: z.string().optional().describe("相关代码/上下文，帮助定位"),
      ...common,
    },
    outputShape: OUTPUT_SHAPE,
    promptKey: "diagnose_error_screenshot",
    media: "image",
    defaultThinking: true,
  },
  {
    name: "understand_technical_diagram",
    title: "技术图理解",
    description: "解读架构图/流程图/UML/ER/时序图等：节点、连线、流程与设计意图。需要读懂一张技术示意图时使用。",
    inputShape: { ...imageField, ...common },
    outputShape: OUTPUT_SHAPE,
    promptKey: "understand_technical_diagram",
    media: "image",
    defaultThinking: true,
  },
  {
    name: "analyze_data_visualization",
    title: "图表读数",
    description: "读懂图表/仪表盘并抽取数据与洞察（趋势、异常、数值）。需要从图表里读出数字或结论时使用。",
    inputShape: { ...imageField, ...common },
    outputShape: OUTPUT_SHAPE,
    promptKey: "analyze_data_visualization",
    media: "image",
    defaultThinking: true,
  },
  {
    name: "ui_diff_check",
    title: "UI 截图对比",
    description: "对比两张 UI 截图（A 基准 / B 对照），逐条列出视觉与实现差异及可能的回归。做视觉回归/前后对比时使用。",
    inputShape: {
      image_a: z.string().describe("基准图 A：路径/URL/data URI"),
      image_b: z.string().describe("对照图 B：路径/URL/data URI"),
      focus: z.string().optional().describe("重点关注的区域/方面"),
      ...common,
    },
    outputShape: OUTPUT_SHAPE,
    promptKey: "ui_diff_check",
    media: "twoImages",
    defaultThinking: true,
  },
  {
    name: "image_analysis",
    title: "通用图像理解",
    description: "通用兜底：理解任意图片并回答问题。不确定用哪个专用工具，或只是想问一张图时使用。",
    inputShape: { ...imageField, ...common },
    outputShape: OUTPUT_SHAPE,
    promptKey: "image_analysis",
    media: "image",
    defaultThinking: false,
  },
  {
    name: "video_analysis",
    title: "视频理解",
    description: "理解一段视频（时序+画面）并回答问题。无原生视频能力的后端会自动走帧采样。需要分析录屏/短视频时使用。",
    inputShape: {
      video: z.string().describe("视频：本地路径 / file:// / http(s):// / data: URI"),
      ...common,
    },
    outputShape: OUTPUT_SHAPE,
    promptKey: "video_analysis",
    media: "video",
    defaultThinking: false,
  },
];
