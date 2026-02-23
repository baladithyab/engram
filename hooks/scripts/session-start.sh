#!/bin/bash
# SessionStart hook: load relevant project memories into context
# Queries SurrealDB for project-scoped memories and injects them

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_PATH="${SURREAL_DATA_PATH:-$HOME/.claude/surrealdb-memory/data}"

# Skip if no database exists yet
if [ ! -d "$DATA_PATH" ]; then
  exit 0
fi

# TODO: Query SurrealDB for project memories and output as system context
# For MVP, this is a placeholder that will be implemented once the MCP server
# is fully functional. The Stop hook (prompt-based) handles memory storage.

exit 0
