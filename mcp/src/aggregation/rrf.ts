/**
 * Reciprocal Rank Fusion (RRF) — merges multiple ranked result sets
 * into a single unified ranking using the formula: 1/(k + rank + 1).
 */

export interface RankedResult {
  id: string;
  data: unknown;
  source: string;
}

export interface RRFResult {
  id: string;
  data: unknown;
  rrf_score: number;
  sources: string[];
}

/**
 * Merge multiple ranked result sets using Reciprocal Rank Fusion.
 *
 * For each result in each set, the RRF score contribution is 1/(k + rank + 1),
 * where rank is the 0-based position in the source list. Scores accumulate
 * across sets for the same ID.
 *
 * @param resultSets - Array of { source, results } where results are ordered by relevance
 * @param k - Smoothing constant (default 60, standard RRF value)
 * @param limit - Maximum number of results to return
 */
export function reciprocalRankFusion(
  resultSets: { source: string; results: RankedResult[] }[],
  k = 60,
  limit = 10,
): RRFResult[] {
  // Accumulate RRF scores per unique ID
  const scoreMap = new Map<string, { data: unknown; score: number; sources: Set<string> }>();

  for (const { source, results } of resultSets) {
    for (let rank = 0; rank < results.length; rank++) {
      const item = results[rank];
      const rrfContribution = 1 / (k + rank + 1);

      const existing = scoreMap.get(item.id);
      if (existing) {
        existing.score += rrfContribution;
        existing.sources.add(source);
      } else {
        scoreMap.set(item.id, {
          data: item.data,
          score: rrfContribution,
          sources: new Set([source]),
        });
      }
    }
  }

  // Sort by accumulated RRF score descending, then limit
  const merged: RRFResult[] = [];
  for (const [id, entry] of scoreMap) {
    merged.push({
      id,
      data: entry.data,
      rrf_score: entry.score,
      sources: [...entry.sources],
    });
  }

  merged.sort((a, b) => b.rrf_score - a.rrf_score);
  return merged.slice(0, limit);
}
