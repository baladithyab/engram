/**
 * Recursive memory processing tools — memory_peek, memory_partition, memory_aggregate.
 *
 * These tools enable Claude to introspect the memory store at a statistical level,
 * split memories into partitions for recursive processing, and merge results from
 * multiple sub-searches using Reciprocal Rank Fusion.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SurrealDBClient } from "./surrealdb-client.js";
import { reciprocalRankFusion } from "./aggregation/rrf.js";
import type { RankedResult } from "./aggregation/rrf.js";
import { createHash } from "node:crypto";

const SCOPES = ["session", "project", "user"] as const;

export function registerRecursiveTools(server: McpServer, db: SurrealDBClient): void {
  // memory_peek — Statistical sampling of the memory store
  server.tool(
    "memory_peek",
    "Get a statistical overview of memory contents: counts by type/status, tag frequency, date range, and sample records. Useful for understanding what the memory store contains before deeper queries.",
    {
      scope: z.enum(["session", "project", "user"]).optional().describe("Scope to peek into (default: all scopes)"),
      sample_n: z.number().optional().describe("Number of sample memories to return (default 5)"),
      focus: z.string().optional().describe("Optional topic to focus samples on via BM25 search"),
    },
    async ({ scope, sample_n, focus }) => {
      try {
        const sampleCount = sample_n ?? 5;
        const scopesToQuery = scope ? [scope] : [...SCOPES];

        const typeCounts: Record<string, number> = {};
        const statusCounts: Record<string, number> = {};
        const tagFrequency: Record<string, number> = {};
        let minDate: string | null = null;
        let maxDate: string | null = null;
        const samples: unknown[] = [];

        for (const s of scopesToQuery) {
          try {
            // Count by memory_type
            const typeRows = await db.queryInScope<{ memory_type: string; count: number }>(
              s,
              `SELECT memory_type, count() AS count FROM memory GROUP BY memory_type`,
            );
            for (const row of typeRows) {
              if (row?.memory_type) {
                typeCounts[row.memory_type] = (typeCounts[row.memory_type] ?? 0) + (row.count ?? 0);
              }
            }

            // Count by status
            const statusRows = await db.queryInScope<{ status: string; count: number }>(
              s,
              `SELECT status, count() AS count FROM memory GROUP BY status`,
            );
            for (const row of statusRows) {
              if (row?.status) {
                statusCounts[row.status] = (statusCounts[row.status] ?? 0) + (row.count ?? 0);
              }
            }

            // Tag frequency: select all tags, flatten, count
            const tagRows = await db.queryInScope<{ tags: string[] }>(
              s,
              `SELECT tags FROM memory WHERE array::len(tags) > 0`,
            );
            for (const row of tagRows) {
              if (Array.isArray(row?.tags)) {
                for (const tag of row.tags) {
                  tagFrequency[tag] = (tagFrequency[tag] ?? 0) + 1;
                }
              }
            }

            // Date range
            const dateRows = await db.queryInScope<{ min_date: string; max_date: string }>(
              s,
              `SELECT math::min(created_at) AS min_date, math::max(created_at) AS max_date FROM memory GROUP ALL`,
            );
            for (const row of dateRows) {
              if (row?.min_date && (!minDate || row.min_date < minDate)) minDate = row.min_date;
              if (row?.max_date && (!maxDate || row.max_date > maxDate)) maxDate = row.max_date;
            }

            // Samples
            if (focus) {
              const focusSamples = await db.queryInScope(
                s,
                `SELECT *, search::score(1) AS relevance FROM memory
                  WHERE content @1@ $focus AND status = 'active'
                  ORDER BY relevance DESC LIMIT $limit`,
                { focus, limit: sampleCount },
              );
              for (const m of focusSamples) {
                samples.push({ ...(m as Record<string, unknown>), _scope: s });
              }
            } else {
              const randomSamples = await db.queryInScope(
                s,
                `SELECT * FROM memory WHERE status = 'active' ORDER BY rand() LIMIT $limit`,
                { limit: sampleCount },
              );
              for (const m of randomSamples) {
                samples.push({ ...(m as Record<string, unknown>), _scope: s });
              }
            }
          } catch {
            // Scope database may not exist yet — skip
          }
        }

        // Sort tags by frequency, top 20
        const topTags = Object.entries(tagFrequency)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([tag, count]) => ({ tag, count }));

        // Trim samples to requested count
        const finalSamples = samples.slice(0, sampleCount);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              scopes_queried: scopesToQuery,
              type_counts: typeCounts,
              status_counts: statusCounts,
              top_tags: topTags,
              date_range: { min: minDate, max: maxDate },
              sample_count: finalSamples.length,
              samples: finalSamples,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error peeking at memory: ${err}` }],
          isError: true,
        };
      }
    },
  );

  // memory_partition — Split memories into partitions for recursive processing
  server.tool(
    "memory_partition",
    "Split memories into partitions by tag, date, type, scope, or importance band. Returns partition descriptors with counts (not full records) for planning recursive sub-queries.",
    {
      partition_by: z.enum(["tag", "date", "type", "scope", "importance_band"]).describe(
        "How to partition: tag (by tag), date (by month), type (by memory_type), scope (by scope), importance_band (quartiles)",
      ),
      scope: z.enum(["session", "project", "user"]).optional().describe("Scope to partition (default: all)"),
      max_partitions: z.number().optional().describe("Maximum number of partitions to return (default 4)"),
    },
    async ({ partition_by, scope, max_partitions }) => {
      try {
        const maxP = max_partitions ?? 4;
        const scopesToQuery = scope ? [scope] : [...SCOPES];
        const partitions: { key: string; count: number; avg_importance?: number }[] = [];

        if (partition_by === "tag") {
          const tagCounts: Record<string, { count: number; totalImportance: number }> = {};

          for (const s of scopesToQuery) {
            try {
              const rows = await db.queryInScope<{ tags: string[]; importance: number }>(
                s,
                `SELECT tags, importance FROM memory WHERE status = 'active' AND array::len(tags) > 0`,
              );
              for (const row of rows) {
                if (!Array.isArray(row?.tags)) continue;
                for (const tag of row.tags) {
                  const entry = tagCounts[tag] ?? { count: 0, totalImportance: 0 };
                  entry.count += 1;
                  entry.totalImportance += row.importance ?? 0.5;
                  tagCounts[tag] = entry;
                }
              }
            } catch { /* skip */ }
          }

          for (const [tag, info] of Object.entries(tagCounts)) {
            partitions.push({
              key: tag,
              count: info.count,
              avg_importance: info.count > 0 ? info.totalImportance / info.count : 0,
            });
          }
          partitions.sort((a, b) => b.count - a.count);

        } else if (partition_by === "date") {
          const monthCounts: Record<string, { count: number; totalImportance: number }> = {};

          for (const s of scopesToQuery) {
            try {
              const rows = await db.queryInScope<{ created_at: string; importance: number }>(
                s,
                `SELECT created_at, importance FROM memory WHERE status = 'active'`,
              );
              for (const row of rows) {
                if (!row?.created_at) continue;
                const month = String(row.created_at).slice(0, 7); // "2026-02"
                const entry = monthCounts[month] ?? { count: 0, totalImportance: 0 };
                entry.count += 1;
                entry.totalImportance += row.importance ?? 0.5;
                monthCounts[month] = entry;
              }
            } catch { /* skip */ }
          }

          for (const [month, info] of Object.entries(monthCounts)) {
            partitions.push({
              key: month,
              count: info.count,
              avg_importance: info.count > 0 ? info.totalImportance / info.count : 0,
            });
          }
          partitions.sort((a, b) => a.key.localeCompare(b.key));

        } else if (partition_by === "type") {
          const typeCounts: Record<string, { count: number; totalImportance: number }> = {};

          for (const s of scopesToQuery) {
            try {
              const rows = await db.queryInScope<{ memory_type: string; count: number; avg_imp: number }>(
                s,
                `SELECT memory_type, count() AS count, math::mean(importance) AS avg_imp FROM memory WHERE status = 'active' GROUP BY memory_type`,
              );
              for (const row of rows) {
                if (!row?.memory_type) continue;
                const entry = typeCounts[row.memory_type] ?? { count: 0, totalImportance: 0 };
                entry.count += row.count ?? 0;
                entry.totalImportance += (row.avg_imp ?? 0.5) * (row.count ?? 0);
                typeCounts[row.memory_type] = entry;
              }
            } catch { /* skip */ }
          }

          for (const [mt, info] of Object.entries(typeCounts)) {
            partitions.push({
              key: mt,
              count: info.count,
              avg_importance: info.count > 0 ? info.totalImportance / info.count : 0,
            });
          }

        } else if (partition_by === "scope") {
          for (const s of SCOPES) {
            try {
              const rows = await db.queryInScope<{ count: number; avg_imp: number }>(
                s,
                `SELECT count() AS count, math::mean(importance) AS avg_imp FROM memory WHERE status = 'active' GROUP ALL`,
              );
              for (const row of rows) {
                partitions.push({
                  key: s,
                  count: row.count ?? 0,
                  avg_importance: row.avg_imp ?? 0,
                });
              }
            } catch {
              partitions.push({ key: s, count: 0, avg_importance: 0 });
            }
          }

        } else if (partition_by === "importance_band") {
          const bands = [
            { key: "0.00-0.25", min: 0, max: 0.25 },
            { key: "0.25-0.50", min: 0.25, max: 0.5 },
            { key: "0.50-0.75", min: 0.5, max: 0.75 },
            { key: "0.75-1.00", min: 0.75, max: 1.0 },
          ];

          for (const band of bands) {
            let totalCount = 0;
            let totalImportance = 0;

            for (const s of scopesToQuery) {
              try {
                const rows = await db.queryInScope<{ count: number; avg_imp: number }>(
                  s,
                  `SELECT count() AS count, math::mean(importance) AS avg_imp FROM memory
                    WHERE status = 'active' AND importance >= $min AND importance < $max
                    GROUP ALL`,
                  { min: band.min, max: band.max === 1.0 ? 1.01 : band.max },
                );
                for (const row of rows) {
                  totalCount += row.count ?? 0;
                  totalImportance += (row.avg_imp ?? 0) * (row.count ?? 0);
                }
              } catch { /* skip */ }
            }

            partitions.push({
              key: band.key,
              count: totalCount,
              avg_importance: totalCount > 0 ? totalImportance / totalCount : 0,
            });
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              partition_by,
              scopes_queried: scopesToQuery,
              total_partitions: Math.min(partitions.length, maxP),
              partitions: partitions.slice(0, maxP),
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error partitioning memories: ${err}` }],
          isError: true,
        };
      }
    },
  );

  // memory_aggregate — Merge results from multiple sub-searches using RRF
  server.tool(
    "memory_aggregate",
    "Merge results from multiple sub-searches into a single ranked list using Reciprocal Rank Fusion. Use after running parallel searches to combine and deduplicate results.",
    {
      results: z.array(z.object({
        source: z.string().describe("Label for this result set (e.g., 'bm25_auth', 'tag_security')"),
        memories: z.array(z.record(z.string(), z.unknown())).describe("Array of memory records from a sub-search"),
      })).describe("Array of result sets to merge"),
      final_limit: z.number().optional().describe("Max results in the merged output (default 10)"),
      dedup_threshold: z.number().optional().describe("Dedup threshold — currently only exact content-hash dedup (default 0.85, reserved for future cosine dedup)"),
    },
    async ({ results, final_limit }) => {
      try {
        const limit = final_limit ?? 10;

        // Convert to RankedResult format
        const resultSets = results.map(({ source, memories }) => ({
          source,
          results: memories.map((m): RankedResult => {
            const id = typeof m.id === "string"
              ? m.id
              : createHash("md5").update(JSON.stringify(m.content ?? m)).digest("hex");
            return { id, data: m, source };
          }),
        }));

        // Run RRF
        const merged = reciprocalRankFusion(resultSets, 60, limit * 2); // over-fetch for dedup

        // Content-hash dedup for exact matches
        const seen = new Set<string>();
        const deduped = merged.filter((item) => {
          const content = typeof (item.data as Record<string, unknown>)?.content === "string"
            ? (item.data as Record<string, unknown>).content as string
            : JSON.stringify(item.data);
          const hash = createHash("md5").update(content).digest("hex");
          if (seen.has(hash)) return false;
          seen.add(hash);
          return true;
        });

        const finalResults = deduped.slice(0, limit);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              input_sets: results.length,
              total_input_items: results.reduce((sum, r) => sum + r.memories.length, 0),
              merged_count: finalResults.length,
              results: finalResults,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error aggregating results: ${err}` }],
          isError: true,
        };
      }
    },
  );
}
