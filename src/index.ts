#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { OpenAICompatibleProvider } from "./provider/openaiCompatible.js";
import { TOOL_DEFS } from "./tools/definitions.js";
import { makeHandler } from "./tools/handler.js";

// NOTE: stdout carries the JSON-RPC stream — all logging MUST go to stderr.

async function main(): Promise<void> {
  const cfg = loadConfig();
  const provider = new OpenAICompatibleProvider(cfg);
  const server = new McpServer({ name: "vision-mcp", version: "0.2.0" });

  for (const def of TOOL_DEFS) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputShape,
        outputSchema: def.outputShape,
      },
      // SDK infers the arg type from inputSchema; our generic handler takes a record.
      makeHandler(def, provider, cfg) as never,
    );
  }

  if (!cfg.apiKey) {
    console.error("[vision-mcp] 警告：未设置 VISION_API_KEY（或 Z_AI_API_KEY），调用将失败。");
  }
  console.error(
    `[vision-mcp] 就绪 · profile=${cfg.profile} model=${cfg.model} base=${cfg.baseUrl} tools=${TOOL_DEFS.length}`,
  );

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[vision-mcp] 启动失败：", err);
  process.exit(1);
});
