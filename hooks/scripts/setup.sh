#!/bin/bash
# Setup hook: runs on --init / first install
# Auto-detects environment and creates default config if needed
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"

CONFIG_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude"
CONFIG_FILE="$CONFIG_DIR/engram.local.md"
LEGACY_CONFIG_FILE="$CONFIG_DIR/surrealdb-memory.local.md"

# If config already exists (new or legacy name), just ensure data dir exists and exit
if [ -f "$CONFIG_FILE" ] || [ -f "$LEGACY_CONFIG_FILE" ]; then
  mkdir -p "${SURREAL_DATA_PATH}" 2>/dev/null || true
  log_info "Config exists, data dir at $SURREAL_DATA_PATH"
  exit 0
fi

# --- Generate scope identifiers ---

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PROJECT_ID="p_$(echo -n "$PROJECT_DIR" | shasum -a 256 | cut -c1-12)"
USER_ID="u_$(echo -n "$HOME" | shasum -a 256 | cut -c1-12)"

log_info "Scope IDs: project=$PROJECT_ID, user=$USER_ID"

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
project_id: ${PROJECT_ID}
user_id: ${USER_ID}
---

# SurrealDB Memory Configuration

Auto-configured on ${CURRENT_DATE} by engram plugin.
Detected local SurrealDB instance at localhost:8000.

${DETECTED_NOTES}

## Scope Identifiers (auto-generated, do not edit)
- **Project ID:** \`${PROJECT_ID}\` (derived from project path)
- **User ID:** \`${USER_ID}\` (derived from home directory)
- **Session ID:** generated per-session from CLAUDE_SESSION_ID

These IDs isolate memory: each project gets its own database,
each user gets their own database, each session is ephemeral.

Edit the YAML frontmatter above to change settings.
Run /memory-setup to reconfigure interactively.
EOF
else
  cat > "$CONFIG_FILE" << EOF
---
mode: embedded
data_path: ~/.claude/engram/data
namespace: memory
project_id: ${PROJECT_ID}
user_id: ${USER_ID}
---

# SurrealDB Memory Configuration

Auto-configured on ${CURRENT_DATE} by engram plugin.
Using embedded SurrealKV (zero-config, persistent).

${DETECTED_NOTES}

## Scope Identifiers (auto-generated, do not edit)
- **Project ID:** \`${PROJECT_ID}\` (derived from project path)
- **User ID:** \`${USER_ID}\` (derived from home directory)
- **Session ID:** generated per-session from CLAUDE_SESSION_ID

These IDs isolate memory: each project gets its own database,
each user gets their own database, each session is ephemeral.

Edit the YAML frontmatter above to change settings.
Run /memory-setup to reconfigure interactively.
EOF
fi

# Ensure data directory exists for embedded mode
if [ "$DETECTED_MODE" = "embedded" ]; then
  mkdir -p "${HOME}/.claude/engram/data" 2>/dev/null || true
fi

# Add to .gitignore if not already there
GITIGNORE="${CLAUDE_PROJECT_DIR:-.}/.gitignore"
if [ -f "$GITIGNORE" ]; then
  if ! grep -q 'engram.local.md' "$GITIGNORE" 2>/dev/null; then
    echo "" >> "$GITIGNORE"
    echo "# Engram plugin config (contains credentials)" >> "$GITIGNORE"
    echo ".claude/engram.local.md" >> "$GITIGNORE"
  fi
fi

log_info "Created config at $CONFIG_FILE (mode: $DETECTED_MODE)"
echo "engram: Auto-configured (mode: ${DETECTED_MODE}). Run /memory-setup to change." >&2

exit 0
