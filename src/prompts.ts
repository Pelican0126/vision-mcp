/**
 * Expert prompt templates — the real quality lever. Each tool shares one call
 * path but injects its own prompt + fixed markdown sections. Principles baked
 * into every prompt: answer comprehensively in ONE pass (the loop is stateless
 * across calls), follow the section headers exactly, transcribe text verbatim
 * where relevant, and write "看不清" rather than guessing.
 */

const PREAMBLE =
  "你是一个高精度视觉分析助手。请一次性、完整地作答；严格按给定的小节标题输出；" +
  "涉及文字时逐字照抄、不要改写；看不清或图中没有的内容写「看不清/未提供」，绝不编造。";

export interface PromptArgs {
  question?: string;
  /** Tool-specific extras (target, framework, lang hint, code context, focus…). */
  extra?: Record<string, string | undefined>;
}

export type PromptKey =
  | "ui_to_artifact"
  | "extract_text_from_screenshot"
  | "diagnose_error_screenshot"
  | "understand_technical_diagram"
  | "analyze_data_visualization"
  | "ui_diff_check"
  | "image_analysis"
  | "video_analysis";

function ask(question: string | undefined, fallback: string): string {
  return question && question.trim() ? `用户问题：${question.trim()}` : fallback;
}

function line(label: string, value: string | undefined): string {
  return value && value.trim() ? `${label}：${value.trim()}\n` : "";
}

const BUILDERS: Record<PromptKey, (a: PromptArgs) => string> = {
  ui_to_artifact: (a) =>
    `${PREAMBLE}\n\n任务：把这张 UI 截图转成${a.extra?.target === "spec" ? "结构化规格" : "可运行代码"}。\n` +
    line("目标框架", a.extra?.framework) +
    line("额外要求", a.question) +
    `\n按以下小节输出：\n## UI 结构\n（组件层级、布局、关键样式）\n## 代码\n（完整可用的实现；用代码块）\n## 备注\n（假设、缺失信息、待确认项）`,

  extract_text_from_screenshot: (a) =>
    `${PREAMBLE}\n\n任务：对这张截图做 OCR，逐字提取所有文本，保留阅读顺序与大致布局。\n` +
    line("语言/区域提示", a.extra?.lang_hint) +
    line("额外要求", a.question) +
    `\n按以下小节输出：\n## 提取文本\n（逐字，保留换行/缩进）\n## 备注\n（不确定处、被遮挡处）`,

  diagnose_error_screenshot: (a) =>
    `${PREAMBLE}\n\n任务：诊断这张报错截图。\n` +
    line("相关代码上下文", a.extra?.code_context) +
    line("额外问题", a.question) +
    `\n按以下小节输出：\n## 根因\n## 错误原文（逐字）\n## 位置\n（文件:行号，若可见）\n## 修复步骤\n（可执行的具体步骤）`,

  understand_technical_diagram: (a) =>
    `${PREAMBLE}\n\n任务：解读这张技术图（架构/流程/UML/ER/时序等）。\n` +
    line("额外问题", a.question) +
    `\n按以下小节输出：\n## 类型\n## 节点\n（逐个列出，含标签）\n## 关系与流程\n（连线、方向、条件）\n## 要点\n（设计意图、风险、疑点）`,

  analyze_data_visualization: (a) =>
    `${PREAMBLE}\n\n任务：读懂这张图表/仪表盘并抽取数据。\n` +
    line("额外问题", a.question) +
    `\n按以下小节输出：\n## 图表类型\n## 数据\n（尽量还原成表格：类别/系列/数值；读不准的标注）\n## 洞察\n（趋势、异常、结论）`,

  ui_diff_check: (a) =>
    `${PREAMBLE}\n\n任务：对比两张 UI 截图（第一张=A/基准，第二张=B/对照），找出所有视觉与实现差异。\n` +
    line("重点关注", a.extra?.focus) +
    line("额外问题", a.question) +
    `\n按以下小节输出：\n## 差异清单\n（逐条：位置 + A 是什么 + B 是什么）\n## 影响\n（哪些差异可能是 bug / 回归）`,

  image_analysis: (a) =>
    `${PREAMBLE}\n\n任务：理解这张图并回答问题。\n` +
    ask(a.question, "用户问题：请描述这张图里的关键信息。") +
    `\n\n按以下小节输出：\n## 回答\n（直接回答）\n## 细节\n（支撑性的具体观察）`,

  video_analysis: (a) =>
    `${PREAMBLE}\n\n任务：理解这段视频（可能以若干关键帧的形式给出，按时间先后排列）并回答问题。\n` +
    ask(a.question, "用户问题：请概述这段视频发生了什么。") +
    `\n\n按以下小节输出：\n## 时序概述\n## 关键事件\n（按时间点/帧）\n## 回答`,
};

export function buildPrompt(key: PromptKey, args: PromptArgs): string {
  return BUILDERS[key](args);
}

/**
 * Shared control prompt for the agentic zoom loop's JSON path (P2). The model
 * either asks to zoom into one of the server-provided regions, or declares it
 * is confident and answers.
 */
export function zoomControlPrompt(regionLabels: string[], task: string): string {
  return (
    `${PREAMBLE}\n\n你正在逐步放大检查一张图以看清细节。当前已把图划分为这些候选区域：` +
    `${regionLabels.join("、")}。\n你的任务：${task}\n\n` +
    `**铁律：只要与任务相关的任何文字/细节小到无法 100% 逐字确定，就必须 zoom 放大，绝不能猜。` +
    `只有当你能逐字确认、不存在任何模糊时才用 done。**\n` +
    `只输出一个 JSON 对象，不要别的文字：\n` +
    `{"action":"zoom"|"done","region":<候选区域编号，zoom 时必填>,"box":<可选 当前视图内归一化 bbox [x,y,w,h]>,"confidence":0~1,"answer":<done 时的最终答案>}\n` +
    `选最相关的区域 action="zoom"；确实已逐字看清才 action="done"。`
  );
}

/** Tool-calling variant: the model calls zoom()/done() instead of emitting JSON. */
export function zoomToolPrompt(regionLabels: string[], task: string): string {
  return (
    `${PREAMBLE}\n\n你正在逐步放大检查一张图。当前候选区域：${regionLabels.join("、")}。\n` +
    `你的任务：${task}\n` +
    `**铁律：只要相关文字/细节小到无法 100% 逐字确定，就必须调用 zoom，绝不能猜。**\n` +
    `需要看清更多细节就调用 zoom（给候选区域编号，或精确的归一化 bbox）；` +
    `只有已能逐字确认时才调用 done（给最终答案与置信度）。`
  );
}
