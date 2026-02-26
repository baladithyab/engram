import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SurrealDBClient } from "./surrealdb-client.js";
import { validateSurql } from "./security/surql-validator.js";

/** Hardcoded schema descriptions for depth-2 exploration */
const TABLE_SCHEMAS: Record<string, object> = {
  memory: {
    fields: {
      content: "string — the memory text",
      memory_type: "string — episodic | semantic | procedural | working",
      scope: "string — session | project | user",
      tags: "array<string>",
      embedding: "option<array<float>> — 384-dim vector (Phase 2)",
      importance: "float 0-1",
      confidence: "float 0-1",
      access_count: "int",
      status: "string — active | consolidated | archived | forgotten",
      memory_strength: "float — computed: importance * decay_rate ^ hours_since_access",
      source: "option<string>",
      session_id: "option<string>",
      created_at: "datetime",
      updated_at: "datetime",
      last_accessed_at: "datetime",
      metadata: "flexible object",
    },
    indexes: [
      "memory_scope (scope)",
      "memory_type_idx (memory_type)",
      "memory_status (status)",
      "memory_tags (tags)",
      "memory_content_search (content) — BM25 full-text",
      "memory_embedding (embedding) — HNSW DIMENSION 384 COSINE",
    ],
  },
  entity: {
    fields: {
      name: "string",
      entity_type: "string",
      description: "string",
      embedding: "option<array<float>>",
      mention_count: "int",
      confidence: "float 0-1",
      scope: "string",
      created_at: "datetime",
      updated_at: "datetime",
    },
    indexes: [
      "entity_name (name)",
      "entity_type_idx (entity_type)",
      "entity_embedding (embedding) — HNSW DIMENSION 384 COSINE",
    ],
  },
  relates_to: {
    fields: {
      in: "record<entity> — source entity",
      out: "record<entity> — target entity",
      relation_type: "string",
      weight: "float 0-1",
      confidence: "float 0-1",
      scope: "string",
      evidence: "option<array<string>>",
      created_at: "datetime",
    },
    note: "TYPE RELATION FROM entity TO entity",
  },
  retrieval_log: {
    fields: {
      memory_id: "option<record<memory>>",
      event_type: "string — search | access | lifecycle_transition | consolidation",
      query: "option<string>",
      strategy: "string",
      results_count: "int",
      memory_ids: "array<record<memory>>",
      old_status: "option<string>",
      new_status: "option<string>",
      was_useful: "option<bool>",
      session_id: "option<string>",
      created_at: "datetime",
    },
    indexes: ["rl_event_type (event_type)", "rl_timestamp (created_at)"],
  },
  evolution_state: {
    fields: {
      key: "string (UNIQUE)",
      value: "flexible object",
      updated_at: "datetime",
    },
    indexes: ["evolution_key (key) — UNIQUE"],
  },
  consolidation_queue: {
    fields: {
      memory_id: "record<memory>",
      reason: "string — decay | duplicate | promotion | merge | scheduled",
      priority: "float 0-1",
      status: "string — pending | processing | completed | failed",
      created_at: "datetime",
      processed_at: "option<datetime>",
    },
    indexes: ["cq_status (status)", "cq_priority (priority)"],
  },
};

const KNOWN_TABLES = ["memory", "entity", "relates_to", "retrieval_log", "evolution_state", "consolidation_queue"];

export function registerCodeModeTools(server: McpServer, db: SurrealDBClient): void {
  // engram_explore — progressive manifest discovery
  server.tool(
    "engram_explore",
    "Progressive discovery of engram database contents. Depth 0: scope counts. Depth 1: table counts per scope. Depth 2: schema info for a table. Depth 3: sample records.",
    {
      depth: z.number().min(0).max(3).describe("Discovery depth: 0=scopes, 1=tables, 2=schema, 3=samples"),
      scope: z.enum(["session", "project", "user", "all"]).optional().describe("Which scope to explore (default: all)"),
      table: z.string().optional().describe("Table name for depth 2/3 (e.g., 'memory', 'entity')"),
      sample_size: z.number().optional().describe("Number of sample records for depth 3 (default: 5)"),
    },
    async ({ depth, scope, table, sample_size }) => {
      try {
        // Depth 0: scope-level counts from getStatus()
        if (depth === 0) {
          const status = await db.getStatus();
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                depth: 0,
                description: "Scope-level overview",
                connected: status.connected,
                mode: status.mode,
                scopes: status.scopes,
                totalMemories: status.totalMemories,
                totalEntities: status.totalEntities,
              }, null, 2),
            }],
          };
        }

        // Depth 1: table counts per scope
        if (depth === 1) {
          const scopes = scope && scope !== "all" ? [scope] : ["session", "project", "user"];
          const result: Record<string, Record<string, number>> = {};

          for (const s of scopes) {
            result[s] = {};
            for (const t of KNOWN_TABLES) {
              try {
                const rows = await db.queryInScope(s, `SELECT count() FROM type::table($table) GROUP ALL`, { table: t });
                const row = rows[0] as Record<string, unknown> | undefined;
                result[s][t] = (row?.count as number) ?? 0;
              } catch {
                result[s][t] = 0;
              }
            }
          }

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ depth: 1, description: "Table counts per scope", scopes: result }, null, 2),
            }],
          };
        }

        // Depth 2: schema info for a specific table
        if (depth === 2) {
          if (!table) {
            return {
              content: [{ type: "text" as const, text: `Error: 'table' parameter required for depth 2. Available tables: ${KNOWN_TABLES.join(", ")}` }],
              isError: true,
            };
          }
          const schema = TABLE_SCHEMAS[table];
          if (!schema) {
            return {
              content: [{ type: "text" as const, text: `Unknown table '${table}'. Available tables: ${KNOWN_TABLES.join(", ")}` }],
              isError: true,
            };
          }
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ depth: 2, description: `Schema for '${table}'`, table, schema }, null, 2),
            }],
          };
        }

        // Depth 3: sample records
        if (depth === 3) {
          if (!table) {
            return {
              content: [{ type: "text" as const, text: `Error: 'table' parameter required for depth 3. Available tables: ${KNOWN_TABLES.join(", ")}` }],
              isError: true,
            };
          }
          if (!KNOWN_TABLES.includes(table)) {
            return {
              content: [{ type: "text" as const, text: `Unknown table '${table}'. Available tables: ${KNOWN_TABLES.join(", ")}` }],
              isError: true,
            };
          }

          const limit = sample_size ?? 5;
          const targetScope = scope && scope !== "all" ? scope : "project";
          const rows = await db.queryInScope(targetScope, `SELECT * FROM type::table($table) LIMIT $limit`, { table, limit });

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                depth: 3,
                description: `Sample records from '${table}' in ${targetScope} scope`,
                table,
                scope: targetScope,
                count: (rows as unknown[]).length,
                records: rows,
              }, null, 2),
            }],
          };
        }

        return {
          content: [{ type: "text" as const, text: "Invalid depth. Use 0-3." }],
          isError: true,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error exploring engram: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // engram_execute — run SurrealQL with safety validation
  server.tool(
    "engram_execute",
    "Execute a SurrealQL query against the engram database with safety validation. Dangerous DDL operations are blocked. Write operations require explicit opt-in.",
    {
      surql: z.string().describe("The SurrealQL query to execute"),
      scope: z.enum(["session", "project", "user"]).optional().describe("Scope to execute in (default: project)"),
      allow_writes: z.boolean().optional().describe("Allow write operations (INSERT, UPDATE, etc.). Default: false"),
    },
    async ({ surql, scope, allow_writes }) => {
      try {
        const targetScope = scope ?? "project";
        const allowWrites = allow_writes ?? false;

        // Validate query safety
        const validation = validateSurql(surql, allowWrites);
        if (!validation.valid) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                executed: false,
                errors: validation.errors,
                requires_write: validation.requiresWrite,
                hint: validation.requiresWrite && !allowWrites
                  ? "Set allow_writes=true to permit write operations"
                  : "This query contains blocked operations that cannot be executed",
              }, null, 2),
            }],
            isError: true,
          };
        }

        // Execute the query
        const start = performance.now();
        const rows = await db.queryInScope(targetScope, surql);
        const elapsed = Math.round(performance.now() - start);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              executed: true,
              scope: targetScope,
              requires_write: validation.requiresWrite,
              query_time_ms: elapsed,
              results: rows,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error executing query: ${err}` }],
          isError: true,
        };
      }
    }
  );
}
