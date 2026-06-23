import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TOOL_DEFS } from "../src/tools/definitions.js";

describe("tool definitions", () => {
  it("declares 8 tools with unique names", () => {
    expect(TOOL_DEFS).toHaveLength(8);
    expect(new Set(TOOL_DEFS.map((t) => t.name)).size).toBe(8);
  });

  it("every tool has a valid input + output zod shape", () => {
    for (const def of TOOL_DEFS) {
      expect(() => z.object(def.inputShape)).not.toThrow();
      expect(() => z.object(def.outputShape)).not.toThrow();
    }
  });

  it("input schemas accept a minimal valid call", () => {
    const sample: Record<string, unknown> = {
      image: "x",
      image_a: "a",
      image_b: "b",
      video: "v",
    };
    for (const def of TOOL_DEFS) {
      const parsed = z.object(def.inputShape).safeParse(sample);
      expect(parsed.success, `${def.name} input`).toBe(true);
    }
  });

  it("output schema validates a representative structuredContent", () => {
    const out = {
      markdown: "## 回答\nok",
      rounds: 2,
      warnings: [],
      provider: "glm",
      model: "glm-4.6v",
      confidence: 0.8,
      regions: [{ box: [0, 0, 0.5, 0.5], note: "左上" }],
    };
    for (const def of TOOL_DEFS) {
      expect(z.object(def.outputShape).safeParse(out).success, `${def.name} output`).toBe(true);
    }
  });
});
