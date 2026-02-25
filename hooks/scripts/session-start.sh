#!/bin/bash
# SessionStart hook: inject Engram memory system context
# Outputs JSON with additionalContext for system prompt injection
#
# MemEvolve EURM mapping:
#   This hook implements the RETRIEVE (R) module — selecting relevant
#   memories from persistent storage to prime the current session context.
#   It pulls from all three tiers: user > project > session (if resuming).
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"

# Skip if no data directory exists yet (plugin not initialized)
DATA_PATH="${SURREAL_DATA_PATH:-$HOME/.claude/engram/data}"
if [ "$SURREAL_MODE" = "embedded" ] && [ ! -d "$DATA_PATH" ]; then
  exit 0
fi

# For local/remote modes, check connectivity
if [ "$SURREAL_MODE" = "local" ] || [ "$SURREAL_MODE" = "remote" ]; then
  if [ -n "${SURREAL_HTTP_URL}" ]; then
    if ! curl -sf "${SURREAL_HTTP_URL}/health" --connect-timeout 2 &>/dev/null; then
      log_warn "SurrealDB not reachable at $SURREAL_HTTP_URL, skipping memory pull"
      exit 0
    fi
  fi
fi

# --- Build Engram memory context ---

CONTEXT="## Engram Memory System Active

Engram is connected (mode: ${SURREAL_MODE}). Persistent, hierarchical, self-evolving memory powered by SurrealDB.

**FIRST ACTION: Call \`recall_memories\` with a query describing the current project or task to load relevant context from past sessions.**

### Memory Hierarchy (3 scopes, each its own SurrealDB database)
- **Session** — current conversation working memory (1.5x retrieval weight)
- **Project** — codebase knowledge persisting across sessions (1.0x weight)
- **User** — cross-project knowledge and preferences (0.7x weight)

### Available MCP Tools

**Core (Phase 1):**
- \`store_memory\` — persist knowledge (scope: session/project/user, type: episodic/semantic/procedural/working)
- \`recall_memories\` — BM25 search across all scopes with weighted merge and memory_strength scoring
- \`search_knowledge_graph\` — entity search + graph traversal (1-3 hops)
- \`reflect_and_consolidate\` — promote, archive, deduplicate memories
- \`promote_memory\` — move memory to a higher scope
- \`update_memory\` — update content, tags, or importance
- \`tag_memory\` — add tags (additive)
- \`forget_memory\` — soft-delete outdated information
- \`get_memory_status\` — per-scope counts and connection info

**Code Intelligence (Phase 3):**
- \`engram_explore\` — natural language codebase queries via memory-augmented retrieval
- \`engram_execute\` — validated SurrealQL execution with AST safety checks
- \`recall_skill\` — retrieve procedural memories as executable skill patterns
- \`mark_retrieval_useful\` — feedback signal to tune retrieval strategy

**Observability (Phase 4):**
- \`memory_peek\` — inspect raw memory records by ID
- \`memory_partition\` — view scope database sizes and distribution
- \`memory_aggregate\` — statistics across memory types, scopes, and decay states

**Evolution (Phase 5):**
- \`evolve_memory_system\` — adjust decay rates, scope weights, promotion thresholds

### Memory Lifecycle
Memories follow: active -> consolidated -> archived -> forgotten
- Exponential decay: working (~1h), episodic (1d), semantic (7d), procedural (30d)
- Each recall strengthens the memory (access_count extends effective half-life by 20%)
- The Stop hook consolidates session learnings automatically
- High-value session memories promote to project scope (importance >= 0.5, access >= 2)

### Usage Patterns
- Start tasks by calling \`recall_memories\` to check what's already known
- Store architectural decisions as type=semantic, scope=project, importance=0.8
- Store debugging patterns as type=procedural, scope=project, importance=0.7
- Store cross-project knowledge with scope=user
- Use /remember, /recall, /forget commands for manual control"

# Output as JSON with additionalContext for system prompt injection
ESCAPED_CONTEXT=$(printf '%s' "$CONTEXT" | python3 -c "
import sys, json
content = sys.stdin.read()
print(json.dumps(content))
" 2>/dev/null || echo '"Engram memory system active. Call recall_memories to load context."')

cat << EOF
{
  "hookSpecificOutput": {
    "additionalContext": ${ESCAPED_CONTEXT}
  }
}
EOF

log_info "SessionStart: injected Engram context (mode: $SURREAL_MODE)"
exit 0
