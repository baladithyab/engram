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
      metadata: z.record(z.string(), z.unknown()).optional().describe("Arbitrary metadata to attach"),
    },
    async ({ content, memory_type, scope, tags, importance, metadata }) => {
      try {
        const result = await db.storeMemory({
          content,
          memoryType: memory_type,
          scope,
          tags,
          importance,
          metadata,
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

  // update_memory — update content, tags, importance, or metadata of an existing memory
  server.tool(
    "update_memory",
    "Update an existing memory's content, tags, importance, or metadata.",
    {
      memory_id: z.string().describe("The record ID of the memory to update"),
      content: z.string().optional().describe("New content (replaces existing)"),
      tags: z.array(z.string()).optional().describe("New tags (replaces existing)"),
      importance: z.number().min(0).max(1).optional().describe("New importance score"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Metadata to merge into existing"),
    },
    async ({ memory_id, content, tags, importance, metadata }) => {
      try {
        const setClauses: string[] = ["updated_at = time::now()"];
        const vars: Record<string, unknown> = { id: memory_id };

        if (content !== undefined) {
          setClauses.push("content = $content");
          vars.content = content;
        }
        if (tags !== undefined) {
          setClauses.push("tags = $tags");
          vars.tags = tags;
        }
        if (importance !== undefined) {
          setClauses.push("importance = $importance");
          vars.importance = importance;
        }
        if (metadata !== undefined) {
          // Merge metadata keys individually
          for (const [k, v] of Object.entries(metadata)) {
            const safeKey = k.replace(/[^a-zA-Z0-9_]/g, "_");
            setClauses.push(`metadata.${safeKey} = $meta_${safeKey}`);
            vars[`meta_${safeKey}`] = v;
          }
        }

        await db.query(
          `UPDATE $id SET ${setClauses.join(", ")}`,
          vars
        );

        return {
          content: [{ type: "text" as const, text: `Memory ${memory_id} updated.` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error updating memory: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // tag_memory — add tags to an existing memory (additive, does not replace)
  server.tool(
    "tag_memory",
    "Add tags to an existing memory without removing existing tags.",
    {
      memory_id: z.string().describe("The record ID of the memory to tag"),
      tags: z.array(z.string()).describe("Tags to add"),
    },
    async ({ memory_id, tags }) => {
      try {
        // Use array::union to add without duplicates
        await db.query(
          `UPDATE $id SET tags = array::union(tags, $new_tags), updated_at = time::now()`,
          { id: memory_id, new_tags: tags }
        );

        return {
          content: [{ type: "text" as const, text: `Added tags [${tags.join(", ")}] to memory ${memory_id}.` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error tagging memory: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // search_knowledge_graph — search entities and traverse relationships
  server.tool(
    "search_knowledge_graph",
    "Search the knowledge graph for entities and their relationships. Traverses the entity-relates_to graph.",
    {
      query: z.string().describe("Entity name or keyword to search for"),
      entity_type: z.string().optional().describe("Filter by entity type (e.g., 'file', 'concept', 'person')"),
      depth: z.number().min(1).max(3).optional().describe("Relationship traversal depth (1-3, default 1)"),
      limit: z.number().optional().describe("Max entities to return, default 10"),
    },
    async ({ query, entity_type, depth, limit }) => {
      try {
        const maxDepth = depth ?? 1;
        const maxResults = limit ?? 10;

        // Search for matching entities
        let entityQuery = `SELECT * FROM entity WHERE string::lowercase(name) CONTAINS string::lowercase($query) OR string::lowercase(description) CONTAINS string::lowercase($query)`;
        if (entity_type) {
          entityQuery += ` AND entity_type = $entity_type`;
        }
        entityQuery += ` LIMIT $limit`;

        const entities = await db.query(entityQuery, {
          query,
          entity_type: entity_type ?? null,
          limit: maxResults,
        });

        // For each found entity, traverse relationships up to depth
        const results: unknown[] = [];
        const flatEntities = (entities as any[]).flat();

        for (const entity of flatEntities) {
          if (!entity?.id) continue;

          let relQuery: string;
          if (maxDepth === 1) {
            relQuery = `SELECT *, in.name AS from_name, out.name AS to_name FROM relates_to WHERE in = $id OR out = $id`;
          } else if (maxDepth === 2) {
            relQuery = `SELECT *, in.name AS from_name, out.name AS to_name FROM relates_to WHERE in = $id OR out = $id OR in IN (SELECT VALUE out FROM relates_to WHERE in = $id) OR out IN (SELECT VALUE in FROM relates_to WHERE out = $id)`;
          } else {
            // depth 3 — broader traversal
            relQuery = `SELECT *, in.name AS from_name, out.name AS to_name FROM relates_to WHERE in = $id OR out = $id`;
          }

          const relations = await db.query(relQuery, { id: entity.id });

          results.push({
            entity,
            relationships: (relations as any[]).flat(),
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ entities_found: flatEntities.length, results }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error searching knowledge graph: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // reflect_and_consolidate — trigger consolidation pipeline
  server.tool(
    "reflect_and_consolidate",
    "Trigger memory consolidation: find duplicate/similar memories, identify promotion candidates, and queue stale memories for archival.",
    {
      scope: z.enum(["session", "project", "user"]).optional().describe("Scope to consolidate (default: all)"),
      dry_run: z.boolean().optional().describe("If true, report what would happen without making changes"),
    },
    async ({ scope, dry_run }) => {
      try {
        const isDryRun = dry_run ?? false;
        const report: {
          promotionCandidates: unknown[];
          staleCandidates: unknown[];
          duplicateCandidates: unknown[];
          actionsPerformed: string[];
        } = {
          promotionCandidates: [],
          staleCandidates: [],
          duplicateCandidates: [],
          actionsPerformed: [],
        };

        // 1. Find promotion candidates: high importance, frequently accessed session memories
        let promoQuery = `SELECT * FROM memory
          WHERE status = 'active' AND scope = 'session'
            AND (importance >= 0.5 OR access_count >= 2)`;
        if (scope) {
          promoQuery = `SELECT * FROM memory
            WHERE status = 'active' AND scope = $scope
              AND (importance >= 0.5 OR access_count >= 2)`;
        }
        const promoResults = await db.query(promoQuery, { scope: scope ?? null });
        report.promotionCandidates = (promoResults as any[]).flat();

        // 2. Find stale memories: low importance, old, not recently accessed
        let staleQuery = `SELECT * FROM memory
          WHERE status = 'active'
            AND importance < 0.3
            AND access_count < 2
            AND created_at < time::now() - 7d`;
        if (scope) {
          staleQuery += ` AND scope = $scope`;
        }
        const staleResults = await db.query(staleQuery, { scope: scope ?? null });
        report.staleCandidates = (staleResults as any[]).flat();

        // 3. Find potential duplicates: memories with overlapping tags in the same scope
        let dupQuery = `SELECT *, tags FROM memory
          WHERE status = 'active' AND array::len(tags) > 0`;
        if (scope) {
          dupQuery += ` AND scope = $scope`;
        }
        dupQuery += ` ORDER BY created_at DESC`;
        const dupResults = await db.query(dupQuery, { scope: scope ?? null });
        const allMemories = (dupResults as any[]).flat();

        // Simple tag-overlap duplicate detection
        const seen = new Map<string, any>();
        for (const mem of allMemories) {
          if (!mem?.tags || !Array.isArray(mem.tags)) continue;
          const tagKey = [...mem.tags].sort().join(",");
          if (tagKey && seen.has(tagKey)) {
            report.duplicateCandidates.push({
              memory: mem,
              similar_to: seen.get(tagKey),
            });
          } else if (tagKey) {
            seen.set(tagKey, mem);
          }
        }

        // 4. Perform actions if not dry run
        if (!isDryRun) {
          // Promote session memories that earned it
          for (const mem of report.promotionCandidates as any[]) {
            if (mem?.id && mem.scope === "session") {
              await db.query(
                `UPDATE $id SET scope = 'project', updated_at = time::now(), metadata.promoted_at = time::now(), metadata.promoted_reason = 'auto-consolidation'`,
                { id: mem.id }
              );
              report.actionsPerformed.push(`Promoted ${mem.id} to project scope`);
            }
          }

          // Queue stale memories for archival
          for (const mem of report.staleCandidates as any[]) {
            if (mem?.id) {
              await db.query(
                `CREATE consolidation_queue SET memory_id = $id, reason = 'decay', priority = $priority`,
                { id: mem.id, priority: 1.0 - ((mem.importance as number) ?? 0.5) }
              );
              report.actionsPerformed.push(`Queued ${mem.id} for consolidation (decay)`);
            }
          }

          // Archive stale candidates directly
          for (const mem of report.staleCandidates as any[]) {
            if (mem?.id) {
              await db.query(
                `UPDATE $id SET status = 'archived', updated_at = time::now()`,
                { id: mem.id }
              );
              report.actionsPerformed.push(`Archived ${mem.id} (low strength, low access)`);
            }
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                dry_run: isDryRun,
                promotion_candidates: report.promotionCandidates.length,
                stale_candidates: report.staleCandidates.length,
                duplicate_candidates: report.duplicateCandidates.length,
                actions_performed: report.actionsPerformed,
                details: report,
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error during consolidation: ${err}` }],
          isError: true,
        };
      }
    }
  );
}
