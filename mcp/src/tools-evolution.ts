/**
 * MemEvolve meta-evolution tool — evolve_memory_system.
 *
 * Analyzes retrieval effectiveness, proposes parameter changes, and
 * optionally applies them to evolution_state.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SurrealDBClient } from "./surrealdb-client.js";
import { analyzeStrategies, analyzeScopeUtility } from "./evolution/analyze.js";
import { proposeEvolution } from "./evolution/propose.js";

export function registerEvolutionTools(server: McpServer, db: SurrealDBClient): void {
  server.tool(
    "evolve_memory_system",
    "Analyze retrieval effectiveness and propose (or apply) parameter changes to the memory system. Uses retrieval_log data to identify which strategies and scopes are working well, then proposes bounded adjustments to scope weights and retrieval strategy. Set dry_run=false to apply proposals.",
    {
      dry_run: z.boolean().optional().describe("If true (default), only report proposals without applying. Set false to apply changes."),
      lookback_days: z.number().optional().describe("Number of days of retrieval_log data to analyze (default 7)"),
    },
    async ({ dry_run, lookback_days }) => {
      try {
        const isDryRun = dry_run ?? true;
        const days = lookback_days ?? 7;

        // Read retrieval_log for the lookback window from project scope
        const logs = await db.queryInScope<Record<string, unknown>>(
          "project",
          `SELECT * FROM retrieval_log
            WHERE created_at > time::now() - $lookback
            ORDER BY created_at DESC`,
          { lookback: `${days}d` },
        );

        // Also gather all active memories for scope analysis
        const memories: Record<string, unknown>[] = [];
        for (const scope of ["session", "project", "user"] as const) {
          try {
            const scopeMemories = await db.queryInScope<Record<string, unknown>>(
              scope,
              `SELECT id, scope FROM memory WHERE status = 'active'`,
            );
            memories.push(...scopeMemories);
          } catch {
            // Scope may not exist yet
          }
        }

        // Run analysis
        const strategyAnalysis = analyzeStrategies(logs);
        const scopeAnalysis = analyzeScopeUtility(logs, memories);

        // Read current evolution_state
        const currentStateRows = await db.queryInScope<{ key: string; value: Record<string, unknown> }>(
          "project",
          `SELECT key, value FROM evolution_state`,
        );
        const currentState: Record<string, unknown> = {};
        for (const row of currentStateRows) {
          if (row?.key) currentState[row.key] = row.value;
        }

        // Generate proposals
        const proposals = proposeEvolution(currentState, strategyAnalysis, scopeAnalysis);

        // Apply if not dry run
        if (!isDryRun && proposals.length > 0) {
          for (const proposal of proposals) {
            // Parse the key: "scope_weights.session" -> table key "scope_weights", nested field "session"
            const [stateKey, ...fieldParts] = proposal.key.split(".");

            if (fieldParts.length > 0) {
              const fieldPath = fieldParts.join(".");
              // Update nested field within the evolution_state value object
              await db.queryInScope(
                "project",
                `UPDATE evolution_state SET value.${fieldPath} = $proposed, updated_at = time::now()
                  WHERE key = $key`,
                { key: stateKey, proposed: proposal.proposed },
              );
            } else {
              // Top-level key update
              await db.queryInScope(
                "project",
                `UPSERT evolution_state SET key = $key, value = $proposed, updated_at = time::now()
                  WHERE key = $key`,
                { key: stateKey, proposed: proposal.proposed },
              );
            }
          }

          // Append to evolution_history in retrieval_log
          await db.queryInScope(
            "project",
            `CREATE retrieval_log SET
              event_type = 'consolidation',
              strategy = 'evolution',
              query = $summary,
              results_count = $count,
              created_at = time::now()`,
            {
              summary: `Applied ${proposals.length} evolution proposals`,
              count: proposals.length,
            },
          );
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              dry_run: isDryRun,
              lookback_days: days,
              data_points: logs.length,
              proposals,
              evidence: {
                strategy_analysis: strategyAnalysis,
                scope_analysis: scopeAnalysis,
              },
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error evolving memory system: ${err}` }],
          isError: true,
        };
      }
    },
  );
}
