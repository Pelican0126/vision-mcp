// Quick end-to-end smoke test: spawn the built server over stdio and list tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env },
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`TOOL COUNT: ${tools.length}`);
for (const t of tools) console.log(`- ${t.name}: ${t.title ?? ""}`);
await client.close();
