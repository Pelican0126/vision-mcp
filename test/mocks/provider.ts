import type {
  Capabilities,
  ToolSpec,
  ToolTurn,
  VisionInput,
  VisionProvider,
  VisionResult,
} from "../../src/provider/types.js";

interface MockOptions {
  capabilities?: Partial<Capabilities>;
  /** Scripted tool turns for analyzeWithTools(), consumed in order. */
  toolTurns?: ToolTurn[];
}

/** A scriptable fake provider: returns the next queued text per analyze() call. */
export class MockProvider implements VisionProvider {
  readonly name = "mock";
  readonly model = "mock-v";
  capabilities: Capabilities = {
    video: false,
    thinking: true,
    toolCalling: false,
    grounding: false,
    maxImages: 8,
  };

  readonly calls: VisionInput[] = [];
  private readonly queue: string[];
  private readonly toolTurns: ToolTurn[];

  constructor(scripted: string[], opts: MockOptions = {}) {
    this.queue = [...scripted];
    this.toolTurns = opts.toolTurns ? [...opts.toolTurns] : [];
    if (opts.capabilities) Object.assign(this.capabilities, opts.capabilities);
  }

  async analyze(input: VisionInput): Promise<VisionResult> {
    this.calls.push(input);
    const text = this.queue.shift() ?? '{"action":"done","answer":"fallback"}';
    return { text, meta: { provider: this.name, model: this.model } };
  }

  async analyzeWithTools(input: VisionInput, _tools: ToolSpec[]): Promise<ToolTurn> {
    this.calls.push(input);
    return (
      this.toolTurns.shift() ?? { toolCalls: [{ id: "x", name: "done", arguments: {} }], text: "", meta: { provider: this.name, model: this.model } }
    );
  }
}

/** Make a small solid PNG buffer for media/zoom tests. */
export async function makePng(width = 300, height = 300): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .png()
    .toBuffer();
}
