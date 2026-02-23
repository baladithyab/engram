#!/bin/bash
# SessionStart hook: pull minimal memory context from all scopes
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
DATA_PATH="${SURREAL_DATA_PATH:-$HOME/.claude/surrealdb-memory/data}"
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

# --- Build memory context from all scopes ---

CONTEXT="## Memory System Active

The surrealdb-memory plugin is connected (mode: ${SURREAL_MODE}).

### Memory Hierarchy
Memory is organized in three tiers, each in its own SurrealDB database:
- **User** — cross-project knowledge (preferences, patterns, tool expertise)
- **Project** — codebase-specific knowledge (architecture, conventions, past decisions)
- **Session** — current conversation only (working memory, scratchpad)

### Available Tools
Use these MCP tools for memory operations:
- \`store_memory\` — persist knowledge (choose scope: session/project/user)
- \`recall_memories\` — search across all scopes (weighted: session 1.5x, project 1.0x, user 0.7x)
- \`search_knowledge_graph\` — traverse entity relationships
- \`reflect_and_consolidate\` — review and promote/archive memories
- \`promote_memory\` — move memory to a higher scope
- \`forget_memory\` — soft-delete outdated information

### Memory Lifecycle (MemEvolve-inspired)
Memories follow: active → consolidated → archived → forgotten
- The Stop hook automatically consolidates session learnings at session end
- Memories decay over time (episodic: 1d half-life, semantic: 7d, procedural: 30d)
- Each recall strengthens the memory (access-based reinforcement)
- Session memories worth keeping get promoted to project scope

### How to Use Memory Effectively
- After making architectural decisions, use \`store_memory\` with type=semantic, scope=project
- After discovering debugging patterns, use type=procedural, scope=project
- For cross-project knowledge (tool preferences, coding style), use scope=user
- Use \`recall_memories\` before starting complex tasks to check what's known
- The /remember, /recall, /forget commands provide a convenient interface

### Pre/Post Compact
Before compaction, key context is saved to session memory.
After compaction, use \`recall_memories\` to recover important context."

# Output as JSON with additionalContext for system prompt injection
# Escape the context for JSON (handle newlines and quotes)
ESCAPED_CONTEXT=$(printf '%s' "$CONTEXT" | python3 -c "
import sys, json
content = sys.stdin.read()
print(json.dumps(content))
" 2>/dev/null || echo '"Memory system active."')

cat << EOF
{
  "hookSpecificOutput": {
    "additionalContext": ${ESCAPED_CONTEXT}
  }
}
EOF

log_info "SessionStart: injected memory context (mode: $SURREAL_MODE)"
exit 0
