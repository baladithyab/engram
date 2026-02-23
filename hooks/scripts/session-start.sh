#!/bin/bash
# SessionStart hook: load relevant memories and inject as system context
# Outputs JSON with additionalContext to prepend to system prompt
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"

# Skip if no data directory exists (plugin not initialized yet)
DATA_PATH="${SURREAL_DATA_PATH:-$HOME/.claude/surrealdb-memory/data}"
if [ "$SURREAL_MODE" = "embedded" ] && [ ! -d "$DATA_PATH" ]; then
  exit 0
fi

# For local/remote modes, check if we can reach the server
if [ "$SURREAL_MODE" = "local" ] || [ "$SURREAL_MODE" = "remote" ]; then
  HTTP_URL="${SURREAL_HTTP_URL}"
  if [ -n "$HTTP_URL" ]; then
    if ! curl -sf "${HTTP_URL}/health" --connect-timeout 2 &>/dev/null; then
      log_warn "SurrealDB not reachable at $HTTP_URL, skipping memory load"
      exit 0
    fi
  fi
fi

# Build context message about memory system availability
CONTEXT="The surrealdb-memory plugin is active (mode: ${SURREAL_MODE})."
CONTEXT="${CONTEXT} Use the MCP tools (store_memory, recall_memories, search_knowledge_graph, etc.) to manage persistent memory."
CONTEXT="${CONTEXT} The Stop hook will automatically consolidate session learnings when the session ends."
CONTEXT="${CONTEXT} Use /remember to store, /recall to search, /forget to remove, /memory-status to check."

# Output as JSON with additionalContext for system prompt injection
cat << EOF
{
  "hookSpecificOutput": {
    "additionalContext": "${CONTEXT}"
  }
}
EOF

exit 0
