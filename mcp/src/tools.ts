import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SurrealDBClient } from "./surrealdb-client.js";

export function registerMemoryTools(server: McpServer, db: SurrealDBClient): void {
  // store_memory — create a new memory
  server.tool(
    "store_memory",
    "Store a new memory in SurrealDB. Use this to persist knowledge, decisions, patterns, or experiences.",
    {
      content: z.string().describe("The memory content to store"),
      memory_type: z.enum(["episodic", "semantic", "procedural", "working"]).describe(
        "Type: episodic (events/conversations), semantic (facts/knowledge), procedural (skills/patterns), working (temporary)"
      ),
      scope: z.enum(["session", "project", "user"]).describe(
        "Scope: session (this conversation), project (this codebase), user (across all projects)"
      ),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      importance: z.number().min(0).max(1).optional().describe("Importance score 0-1, default 0.5"),
    },
    async ({ content, memory_type, scope, tags, importance }) => {
      try {
        const result = await db.storeMemory({
          content,
          memoryType: memory_type,
          scope,
          tags,
          importance,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ stored: true, memory_type, scope, tags: tags ?? [] }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error storing memory: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // recall_memories — search and retrieve memories
  server.tool(
    "recall_memories",
    "Search and retrieve relevant memories from SurrealDB. Uses BM25 full-text search.",
    {
      query: z.string().describe("Search query to find relevant memories"),
      scope: z.enum(["session", "project", "user"]).optional().describe("Filter by scope"),
      memory_type: z.enum(["episodic", "semantic", "procedural", "working"]).optional().describe("Filter by type"),
      limit: z.number().optional().describe("Max results to return, default 10"),
    },
    async ({ query, scope, memory_type, limit }) => {
      try {
        const memories = await db.recallMemories({
          query,
          scope,
          memoryType: memory_type,
          limit: limit ?? 10,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(memories, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error recalling memories: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // forget_memory — soft-delete a memory
  server.tool(
    "forget_memory",
    "Mark a memory as forgotten (soft delete). The memory is archived, not permanently deleted.",
    {
      memory_id: z.string().describe("The record ID of the memory to forget"),
      reason: z.string().optional().describe("Why this memory is being forgotten"),
    },
    async ({ memory_id, reason }) => {
      try {
        await db.query(
          `UPDATE $id SET status = 'forgotten', metadata.forget_reason = $reason, updated_at = time::now()`,
          { id: memory_id, reason: reason ?? "manually forgotten" }
        );

        return {
          content: [{ type: "text" as const, text: `Memory ${memory_id} marked as forgotten.` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error forgetting memory: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // get_memory_status — connection and memory stats
  server.tool(
    "get_memory_status",
    "Get the current status of the SurrealDB memory system — connection, counts, mode.",
    {},
    async () => {
      try {
        const status = await db.getStatus();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error getting status: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // promote_memory — move memory to a higher scope
  server.tool(
    "promote_memory",
    "Promote a memory from session to project scope, or from project to user scope.",
    {
      memory_id: z.string().describe("The record ID of the memory to promote"),
      target_scope: z.enum(["project", "user"]).describe("The scope to promote to"),
    },
    async ({ memory_id, target_scope }) => {
      try {
        await db.query(
          `UPDATE $id SET scope = $scope, updated_at = time::now(), metadata.promoted_at = time::now()`,
          { id: memory_id, scope: target_scope }
        );

        return {
          content: [{ type: "text" as const, text: `Memory ${memory_id} promoted to ${target_scope} scope.` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error promoting memory: ${err}` }],
          isError: true,
        };
      }
    }
  );
}
