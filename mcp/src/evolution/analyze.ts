/**
 * Retrieval strategy and scope effectiveness analysis.
 *
 * Analyzes retrieval_log entries to determine which search strategies
 * and memory scopes are producing useful results.
 */

export interface StrategyAnalysis {
  strategy: string;
  total_calls: number;
  useful_count: number;
  useless_count: number;
  unknown_count: number;
  /** useful / (useful + useless), NaN if no feedback at all */
  effectiveness: number;
}

export interface ScopeAnalysis {
  scope: string;
  total_retrieved: number;
  useful_count: number;
  effectiveness: number;
}

/**
 * Analyze retrieval strategies from retrieval_log entries.
 *
 * Groups by strategy field and counts how many had was_useful=true,
 * was_useful=false, or was_useful=null.
 */
export function analyzeStrategies(logs: Record<string, unknown>[]): StrategyAnalysis[] {
  const strategyMap = new Map<string, { total: number; useful: number; useless: number; unknown: number }>();

  for (const log of logs) {
    const strategy = typeof log.strategy === "string" ? log.strategy : "unknown";
    const entry = strategyMap.get(strategy) ?? { total: 0, useful: 0, useless: 0, unknown: 0 };
    entry.total += 1;

    if (log.was_useful === true) {
      entry.useful += 1;
    } else if (log.was_useful === false) {
      entry.useless += 1;
    } else {
      entry.unknown += 1;
    }

    strategyMap.set(strategy, entry);
  }

  const results: StrategyAnalysis[] = [];
  for (const [strategy, entry] of strategyMap) {
    const feedbackTotal = entry.useful + entry.useless;
    results.push({
      strategy,
      total_calls: entry.total,
      useful_count: entry.useful,
      useless_count: entry.useless,
      unknown_count: entry.unknown,
      effectiveness: feedbackTotal > 0 ? entry.useful / feedbackTotal : NaN,
    });
  }

  return results.sort((a, b) => b.total_calls - a.total_calls);
}

/**
 * Analyze scope utility by cross-referencing retrieval_log entries
 * with the memories they returned.
 *
 * Counts how many retrieved memories from each scope were marked useful.
 */
export function analyzeScopeUtility(
  logs: Record<string, unknown>[],
  memories: Record<string, unknown>[],
): ScopeAnalysis[] {
  // Build a lookup: memory id -> scope
  const memoryScopes = new Map<string, string>();
  for (const mem of memories) {
    const id = typeof mem.id === "string" ? mem.id : String(mem.id ?? "");
    const scope = typeof mem.scope === "string" ? mem.scope : "unknown";
    if (id) memoryScopes.set(id, scope);
  }

  const scopeMap = new Map<string, { total: number; useful: number }>();

  for (const log of logs) {
    const memoryIds = Array.isArray(log.memory_ids) ? log.memory_ids : [];
    const wasUseful = log.was_useful;

    for (const mid of memoryIds) {
      const idStr = typeof mid === "string" ? mid : String(mid ?? "");
      const scope = memoryScopes.get(idStr) ?? "unknown";

      const entry = scopeMap.get(scope) ?? { total: 0, useful: 0 };
      entry.total += 1;
      if (wasUseful === true) entry.useful += 1;
      scopeMap.set(scope, entry);
    }
  }

  const results: ScopeAnalysis[] = [];
  for (const [scope, entry] of scopeMap) {
    results.push({
      scope,
      total_retrieved: entry.total,
      useful_count: entry.useful,
      effectiveness: entry.total > 0 ? entry.useful / entry.total : 0,
    });
  }

  return results.sort((a, b) => b.total_retrieved - a.total_retrieved);
}
