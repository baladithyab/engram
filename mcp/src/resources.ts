import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SurrealDBClient } from "./surrealdb-client.js";

export function registerMemoryResources(server: McpServer, db: SurrealDBClient): void {
  // memory://status — current connection and memory stats
  server.resource("memory-status", "memory://status", async (uri) => {
    const status = await db.getStatus();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  });
}
