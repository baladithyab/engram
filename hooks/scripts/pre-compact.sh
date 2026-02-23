#!/bin/bash
# PreCompact hook: save conversation context before compaction discards it
#
# MemEvolve EURM mapping:
#   This hook implements the ENCODE (E) module — transforming raw conversation
#   context into structured memory representations before they are lost.
#   Critical for preserving knowledge that would otherwise vanish during compaction.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"

# Skip if embedded mode and no data directory
DATA_PATH="${SURREAL_DATA_PATH:-$HOME/.claude/surrealdb-memory/data}"
if [ "$SURREAL_MODE" = "embedded" ] && [ ! -d "$DATA_PATH" ]; then
  exit 0
fi

# Output a prompt asking the model to save key context before compaction
# This uses the prompt hook type to let the model decide what's worth saving
cat << 'EOF'
{
  "hookSpecificOutput": {
    "additionalContext": "IMPORTANT: Conversation is about to be compacted. Before context is lost, review what you currently know about this session and use the store_memory MCP tool to preserve critical context:\n\n1. What task is currently in progress? Store as type=working, scope=session\n2. What decisions were made that should persist? Store as type=semantic, scope=project\n3. What patterns or solutions were discovered? Store as type=procedural, scope=project\n4. What errors were encountered and how were they resolved? Store as type=episodic, scope=project\n5. Are there any pending tasks or unresolved issues? Store as type=working, scope=session\n\nOnly store genuinely useful context — don't save trivial operations. Tag memories with relevant keywords for later retrieval. After compaction, use recall_memories to recover saved context."
  }
}
EOF

log_info "PreCompact: injected context preservation prompt"
exit 0
