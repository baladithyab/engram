import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SurrealDBClient, readConfig } from "./surrealdb-client.js";
import type { DeploymentMode } from "./surrealdb-client.js";
import { registerMemoryTools } from "./tools.js";
import { registerMemoryResources } from "./resources.js";

const server = new McpServer({
  name: "surrealdb-memory",
  version: "0.1.0",
});

// Merge config: env vars > local config file > defaults
const fileConfig = readConfig();

const db = new SurrealDBClient({
  mode: (process.env.SURREAL_MODE as DeploymentMode) ?? fileConfig.mode ?? "embedded",
  dataPath: process.env.SURREAL_DATA_PATH ?? fileConfig.dataPath ?? `${process.env.HOME}/.claude/surrealdb-memory/data`,
  url: process.env.SURREAL_URL ?? fileConfig.url,
  username: process.env.SURREAL_USER ?? fileConfig.username ?? "root",
  password: process.env.SURREAL_PASS ?? fileConfig.password ?? "root",
  namespace: process.env.SURREAL_NS ?? fileConfig.namespace ?? "memory",
  database: process.env.SURREAL_DB ?? fileConfig.database ?? "default",
});

registerMemoryTools(server, db);
registerMemoryResources(server, db);

async function main() {
  await db.connect();
  await db.initSchema();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await db.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await db.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error starting surrealdb-memory MCP server:", err);
  process.exit(1);
});
