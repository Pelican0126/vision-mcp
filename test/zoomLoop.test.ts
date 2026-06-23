import { describe, expect, it } from "vitest";
import { navBudget, parseAction, runZoomLoop } from "../src/core/zoomLoop.js";
import { MockProvider, makePng } from "./mocks/provider.js";

describe("parseAction", () => {
  it("parses a zoom action", () => {
    expect(parseAction('{"action":"zoom","region":3,"confidence":0.4}')).toEqual({
      action: "zoom",
      region: 3,
      confidence: 0.4,
      answer: undefined,
    });
  });

  it("parses a done action wrapped in prose/fences", () => {
    const txt = "好的\n```json\n{\"action\":\"done\",\"answer\":\"x\"}\n```";
    expect(parseAction(txt)?.action).toBe("done");
  });

  it("returns null on invalid JSON", () => {
    expect(parseAction("not json at all")).toBeNull();
  });

  it("returns null when action is missing/unknown", () => {
    expect(parseAction('{"foo":1}')).toBeNull();
  });
});

describe("navBudget", () => {
  it("maps detail levels", () => {
    expect(navBudget("normal", 3)).toBe(1);
    expect(navBudget("fine", 3)).toBe(3);
    expect(navBudget("auto", 3)).toBe(2);
    expect(navBudget("auto", 1)).toBe(1);
  });
});

describe("runZoomLoop", () => {
  const base = async (scripted: string[], maxRounds: number) => {
    const provider = new MockProvider(scripted);
    const original = await makePng();
    const result = await runZoomLoop({
      provider,
      original,
      taskPrompt: "TASK",
      navHint: "hint",
      maxRounds,
      maxEdgePx: 256,
      thinking: false,
    });
    return { provider, result };
  };

  it("done on first round → 1 nav + 1 final read", async () => {
    const { result } = await base(['{"action":"done","confidence":0.9}', "## 回答\nDONE"], 3);
    expect(result.rounds).toBe(2);
    expect(result.regions).toHaveLength(0);
    expect(result.text).toBe("## 回答\nDONE");
    expect(result.confidence).toBe(0.9);
  });

  it("one zoom then done records the visited region", async () => {
    const { result } = await base(
      ['{"action":"zoom","region":0,"confidence":0.3}', '{"action":"done"}', "FINAL"],
      3,
    );
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]?.note).toBe("左上");
    expect(result.rounds).toBe(3);
    expect(result.text).toBe("FINAL");
  });

  it("stops at the round budget", async () => {
    const { result } = await base(
      ['{"action":"zoom","region":4}', '{"action":"zoom","region":4}', "FINAL"],
      2,
    );
    expect(result.regions).toHaveLength(2);
    expect(result.rounds).toBe(3); // 2 nav + 1 final
  });

  it("breaks and warns on unparseable action", async () => {
    const { result } = await base(["garbage", "FINAL"], 3);
    expect(result.warnings.join()).toMatch(/解析/);
    expect(result.rounds).toBe(2); // 1 failed nav + final
    expect(result.text).toBe("FINAL");
  });

  it("breaks and warns on out-of-range region", async () => {
    const { result } = await base(['{"action":"zoom","region":99}', "FINAL"], 3);
    expect(result.warnings.join()).toMatch(/越界|缺失/);
    expect(result.regions).toHaveLength(0);
    expect(result.rounds).toBe(2);
  });

  it("uses a grounding bbox when the backend declares grounding", async () => {
    const provider = new MockProvider(
      ['{"action":"zoom","box":[0.25,0.25,0.5,0.5]}', '{"action":"done"}', "FINAL"],
      { capabilities: { grounding: true } },
    );
    const result = await runZoomLoop({
      provider,
      original: await makePng(),
      taskPrompt: "TASK",
      navHint: "hint",
      maxRounds: 3,
      maxEdgePx: 256,
      thinking: false,
    });
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]?.note).toBe("grounding");
    expect(result.regions[0]?.box).toEqual([0.25, 0.25, 0.5, 0.5]);
  });

  it("drives the loop via native tool-calling when supported", async () => {
    const meta = { provider: "mock", model: "mock-v" };
    const provider = new MockProvider(["FINAL"], {
      capabilities: { toolCalling: true },
      toolTurns: [
        { toolCalls: [{ id: "1", name: "zoom", arguments: { region: 2 } }], text: "", meta },
        { toolCalls: [{ id: "2", name: "done", arguments: { confidence: 0.9 } }], text: "", meta },
      ],
    });
    const result = await runZoomLoop({
      provider,
      original: await makePng(),
      taskPrompt: "TASK",
      navHint: "hint",
      maxRounds: 3,
      maxEdgePx: 256,
      thinking: false,
    });
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]?.note).toBe("右上"); // region index 2
    expect(result.confidence).toBe(0.9);
    expect(result.text).toBe("FINAL");
    expect(result.rounds).toBe(3); // 2 tool-calling nav + 1 final read
  });
});

describe("parseAction grounding box", () => {
  it("parses a bbox array", () => {
    expect(parseAction('{"action":"zoom","box":[0.1,0.2,0.3,0.4]}')?.box).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
  it("ignores a malformed box", () => {
    expect(parseAction('{"action":"zoom","box":[0.1,0.2]}')?.box).toBeUndefined();
  });
});
