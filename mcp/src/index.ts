import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SurrealDBClient, readConfig, generateScopeIds } from "./surrealdb-client.js";
import type { DeploymentMode } from "./surrealdb-client.js";
import { registerMemoryTools } from "./tools.js";
import { registerMemoryResources } from "./resources.js";
import { createEmbeddingProvider } from "./embeddings/index.js";
import type { EmbeddingProvider } from "./embeddings/provider.js";
import { registerCodeModeTools } from "./tools-codemode.js";
import { registerSkillTools } from "./tools-skills.js";

const server = new McpServer({
  name: "engram",
  version: "0.2.0",
});

// Generate scope identifiers for hierarchical memory isolation
const scopeIds = generateScopeIds();

// Merge config: env vars > local config file > defaults
const fileConfig = readConfig();

// Initialize embedding provider (local by default, API when configured)
let embedder: EmbeddingProvider | undefined;
try {
  embedder = createEmbeddingProvider({
    provider: process.env.EMBEDDING_PROVIDER ?? fileConfig.embeddingProvider,
    url: process.env.EMBEDDING_URL ?? fileConfig.embeddingUrl,
    model: process.env.EMBEDDING_MODEL ?? fileConfig.embeddingModel,
    apiKey: process.env.EMBEDDING_API_KEY ?? fileConfig.embeddingApiKey,
    dimensions: fileConfig.embeddingDimensions,
  });
} catch {
  // Embedding provider initialization failed — continue without embeddings
}

const db = new SurrealDBClient(
  {
    mode: (process.env.SURREAL_MODE as DeploymentMode) ?? fileConfig.mode ?? "embedded",
    dataPath: process.env.SURREAL_DATA_PATH ?? fileConfig.dataPath ?? `${process.env.HOME}/.claude/engram/data`,
    url: process.env.SURREAL_URL ?? fileConfig.url,
    username: process.env.SURREAL_USER ?? fileConfig.username ?? "root",
    password: process.env.SURREAL_PASS ?? fileConfig.password ?? "root",
    namespace: process.env.SURREAL_NS ?? fileConfig.namespace ?? "memory",
    database: process.env.SURREAL_DB ?? fileConfig.database ?? "default",
  },
  scopeIds,
  embedder,
);

registerMemoryTools(server, db);
registerMemoryResources(server, db);
registerCodeModeTools(server, db);
registerSkillTools(server, db);

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
  console.error("Fatal error starting engram MCP server:", err);
  process.exit(1);
});
