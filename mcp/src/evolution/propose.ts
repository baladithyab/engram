/**
 * Bounded parameter proposal engine for MemEvolve meta-evolution.
 *
 * Proposes changes to memory system parameters (scope weights, decay half-lives,
 * retrieval strategy) based on observed effectiveness data. Changes are bounded
 * to prevent runaway tuning.
 */

import type { StrategyAnalysis, ScopeAnalysis } from "./analyze.js";

export interface EvolutionProposal {
  key: string;
  current: unknown;
  proposed: unknown;
  reason: string;
  confidence: number;
}

/** Minimum retrieval_log entries required before any proposals are made */
const MIN_DATA_POINTS = 50;

/** Maximum scope weight change per evolution cycle */
const MAX_SCOPE_WEIGHT_DELTA = 0.2;

/** Half-life multiplier bounds per cycle: can halve or double, but no more */
const HALF_LIFE_MIN_FACTOR = 0.5;
const HALF_LIFE_MAX_FACTOR = 2.0;

/**
 * Propose bounded parameter changes based on strategy and scope analysis.
 *
 * Returns an empty array with reason "insufficient data" if fewer than
 * MIN_DATA_POINTS retrieval log entries are available.
 */
export function proposeEvolution(
  currentState: Record<string, unknown>,
  strategyAnalysis: StrategyAnalysis[],
  scopeAnalysis: ScopeAnalysis[],
): EvolutionProposal[] {
  // Count total data points across all strategies
  const totalDataPoints = strategyAnalysis.reduce((sum, s) => sum + s.total_calls, 0);

  if (totalDataPoints < MIN_DATA_POINTS) {
    return [];
  }

  const proposals: EvolutionProposal[] = [];

  // Propose scope weight adjustments based on scope effectiveness
  proposeScopeWeightChanges(currentState, scopeAnalysis, proposals);

  // Propose strategy changes based on strategy effectiveness
  proposeStrategyChanges(currentState, strategyAnalysis, proposals);

  return proposals;
}

function proposeScopeWeightChanges(
  currentState: Record<string, unknown>,
  scopeAnalysis: ScopeAnalysis[],
  proposals: EvolutionProposal[],
): void {
  const currentWeights = (currentState.scope_weights ?? {}) as Record<string, number>;
  const defaults: Record<string, number> = { session: 1.5, project: 1.0, user: 0.7 };

  // Only propose changes if we have feedback for at least 2 scopes
  const scopesWithData = scopeAnalysis.filter((s) => s.total_retrieved > 0);
  if (scopesWithData.length < 2) return;

  // Compute average effectiveness across scopes with data
  const avgEffectiveness = scopesWithData.reduce((s, a) => s + a.effectiveness, 0) / scopesWithData.length;

  for (const analysis of scopesWithData) {
    const scope = analysis.scope;
    if (!["session", "project", "user"].includes(scope)) continue;

    const current = currentWeights[scope] ?? defaults[scope] ?? 1.0;

    // If this scope's effectiveness is above average, increase weight slightly
    // If below average, decrease weight slightly
    const effectivenessDelta = analysis.effectiveness - avgEffectiveness;

    // Scale the delta — a 20% effectiveness gap maps to the max allowed weight change
    let weightDelta = effectivenessDelta * MAX_SCOPE_WEIGHT_DELTA;

    // Clamp to bounds
    weightDelta = Math.max(-MAX_SCOPE_WEIGHT_DELTA, Math.min(MAX_SCOPE_WEIGHT_DELTA, weightDelta));

    const proposed = Math.max(0.1, Math.min(3.0, current + weightDelta));

    // Only propose if the change is meaningful (> 0.02)
    if (Math.abs(proposed - current) > 0.02) {
      proposals.push({
        key: `scope_weights.${scope}`,
        current,
        proposed: Math.round(proposed * 100) / 100,
        reason: `Scope "${scope}" effectiveness ${(analysis.effectiveness * 100).toFixed(0)}% vs avg ${(avgEffectiveness * 100).toFixed(0)}%`,
        confidence: Math.min(1.0, analysis.total_retrieved / 50),
      });
    }
  }
}

function proposeStrategyChanges(
  currentState: Record<string, unknown>,
  strategyAnalysis: StrategyAnalysis[],
  proposals: EvolutionProposal[],
): void {
  const currentStrategy = (currentState.retrieval_strategy ?? {}) as Record<string, unknown>;
  const currentDefault = typeof currentStrategy.default_strategy === "string"
    ? currentStrategy.default_strategy
    : "bm25";

  // Only propose strategy switch if we have comparative data
  const strategiesWithFeedback = strategyAnalysis.filter((s) => !isNaN(s.effectiveness) && s.total_calls >= 10);
  if (strategiesWithFeedback.length < 2) return;

  // Find the best-performing strategy
  const best = strategiesWithFeedback.reduce((a, b) =>
    a.effectiveness > b.effectiveness ? a : b,
  );

  // Find the current default's performance
  const currentPerf = strategiesWithFeedback.find((s) => s.strategy === currentDefault);

  if (currentPerf && best.strategy !== currentDefault && best.effectiveness > currentPerf.effectiveness + 0.1) {
    proposals.push({
      key: "retrieval_strategy.default_strategy",
      current: currentDefault,
      proposed: best.strategy,
      reason: `Strategy "${best.strategy}" effectiveness ${(best.effectiveness * 100).toFixed(0)}% vs current "${currentDefault}" ${(currentPerf.effectiveness * 100).toFixed(0)}%`,
      confidence: Math.min(1.0, best.total_calls / 100),
    });
  }
}
