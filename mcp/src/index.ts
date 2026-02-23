import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SurrealDBClient } from "./surrealdb-client.js";
import { registerMemoryTools } from "./tools.js";
import { registerMemoryResources } from "./resources.js";

const server = new McpServer({
  name: "surrealdb-memory",
  version: "0.1.0",
});

const db = new SurrealDBClient({
  mode: (process.env.SURREAL_MODE as "embedded" | "local" | "remote") ?? "embedded",
  dataPath: process.env.SURREAL_DATA_PATH ?? `${process.env.HOME}/.claude/surrealdb-memory/data`,
  url: process.env.SURREAL_URL,
  username: process.env.SURREAL_USER ?? "root",
  password: process.env.SURREAL_PASS ?? "root",
  namespace: process.env.SURREAL_NS ?? "memory",
  database: process.env.SURREAL_DB ?? "default",
});

registerMemoryTools(server, db);
registerMemoryResources(server, db);

async function main() {
  await db.connect();
  await db.initSchema();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting surrealdb-memory MCP server:", err);
  process.exit(1);
});
