#!/bin/bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"

# Ensure data directory exists
mkdir -p "${SURREAL_DATA_PATH:-$HOME/.claude/surrealdb-memory/data}"

# Create default config if it doesn't exist
CONFIG_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude"
CONFIG_FILE="$CONFIG_DIR/surrealdb-memory.local.md"

if [ ! -f "$CONFIG_FILE" ]; then
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_FILE" << 'YAML'
---
mode: embedded
data_path: ~/.claude/surrealdb-memory/data
namespace: memory
database: default
---

# SurrealDB Memory Configuration

This file configures the surrealdb-memory plugin for this project.
Edit the YAML frontmatter above to change settings.

See docs/guides/configuration.md for all available options.
YAML
  echo "Created default memory config at $CONFIG_FILE" >&2
fi

exit 0
