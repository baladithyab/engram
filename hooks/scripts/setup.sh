#!/bin/bash
# Setup hook: runs on --init / first install
# Auto-detects environment and creates default config if needed
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"

CONFIG_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude"
CONFIG_FILE="$CONFIG_DIR/surrealdb-memory.local.md"

# If config already exists, just ensure data dir exists and exit
if [ -f "$CONFIG_FILE" ]; then
  mkdir -p "${SURREAL_DATA_PATH}" 2>/dev/null || true
  log_info "Config exists at $CONFIG_FILE, data dir at $SURREAL_DATA_PATH"
  exit 0
fi

# --- Auto-detect best deployment mode ---

DETECTED_MODE="embedded"
DETECTED_NOTES=""

# Check if surreal binary is installed
if command -v surreal &>/dev/null; then
  SURREAL_VERSION=$(surreal version 2>/dev/null || echo "unknown")
  DETECTED_NOTES="${DETECTED_NOTES}SurrealDB CLI found (${SURREAL_VERSION}). "
fi

# Check if Docker is available
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  DETECTED_NOTES="${DETECTED_NOTES}Docker available. "
fi

# Check if a local SurrealDB is already running
if curl -sf http://localhost:8000/health &>/dev/null; then
  DETECTED_MODE="local"
  DETECTED_NOTES="${DETECTED_NOTES}Local SurrealDB detected at localhost:8000. "
fi

# --- Create default config ---

mkdir -p "$CONFIG_DIR"

CURRENT_DATE=$(date +%Y-%m-%d)

if [ "$DETECTED_MODE" = "local" ]; then
  cat > "$CONFIG_FILE" << EOF
---
mode: local
url: ws://localhost:8000
username: root
password: root
namespace: memory
database: default
---

# SurrealDB Memory Configuration

Auto-configured on ${CURRENT_DATE} by surrealdb-memory plugin.
Detected local SurrealDB instance at localhost:8000.

${DETECTED_NOTES}

Edit the YAML frontmatter above to change settings.
Run /memory-setup to reconfigure interactively.
EOF
else
  cat > "$CONFIG_FILE" << EOF
---
mode: embedded
data_path: ~/.claude/surrealdb-memory/data
namespace: memory
database: default
---

# SurrealDB Memory Configuration

Auto-configured on ${CURRENT_DATE} by surrealdb-memory plugin.
Using embedded SurrealKV (zero-config, persistent).

${DETECTED_NOTES}

Edit the YAML frontmatter above to change settings.
Run /memory-setup to reconfigure interactively.
EOF
fi

# Ensure data directory exists for embedded mode
if [ "$DETECTED_MODE" = "embedded" ]; then
  mkdir -p "${HOME}/.claude/surrealdb-memory/data" 2>/dev/null || true
fi

# Add to .gitignore if not already there
GITIGNORE="${CLAUDE_PROJECT_DIR:-.}/.gitignore"
if [ -f "$GITIGNORE" ]; then
  if ! grep -q 'surrealdb-memory.local.md' "$GITIGNORE" 2>/dev/null; then
    echo "" >> "$GITIGNORE"
    echo "# SurrealDB Memory plugin config (contains credentials)" >> "$GITIGNORE"
    echo ".claude/surrealdb-memory.local.md" >> "$GITIGNORE"
  fi
fi

log_info "Created config at $CONFIG_FILE (mode: $DETECTED_MODE)"
echo "surrealdb-memory: Auto-configured (mode: ${DETECTED_MODE}). Run /memory-setup to change." >&2

exit 0
