#!/bin/bash
# Shared environment config for engram hook scripts.
# Reads .claude/engram.local.md YAML frontmatter (falls back to surrealdb-memory.local.md).
# Source this from other hook scripts: source "$(dirname "$0")/config.sh"

set -uo pipefail

# Plugin root (resolved from this script's location: hooks/scripts/ -> repo root)
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# SurrealDB connection defaults
export SURREAL_MODE="${SURREAL_MODE:-embedded}"
export SURREAL_URL="${SURREAL_URL:-}"
export SURREAL_DATA_PATH="${SURREAL_DATA_PATH:-$HOME/.claude/engram/data}"
export SURREAL_USER="${SURREAL_USER:-root}"
export SURREAL_PASS="${SURREAL_PASS:-root}"
export SURREAL_NS="${SURREAL_NS:-memory}"
export SURREAL_DB="${SURREAL_DB:-default}"

# Read per-project config from .claude/engram.local.md YAML frontmatter (with legacy fallback)
_CONFIG_SEARCH_PATHS=(
  "${CLAUDE_PROJECT_ROOT:-.}/.claude/engram.local.md"
  "${CLAUDE_PROJECT_ROOT:-.}/.claude/surrealdb-memory.local.md"
  "${PWD}/.claude/engram.local.md"
  "${PWD}/.claude/surrealdb-memory.local.md"
)

for _cfg_path in "${_CONFIG_SEARCH_PATHS[@]}"; do
  if [ -f "$_cfg_path" ]; then
    _in_frontmatter=false
    while IFS= read -r line; do
      if [ "$line" = "---" ]; then
        if $_in_frontmatter; then
          break
        else
          _in_frontmatter=true
          continue
        fi
      fi

      if $_in_frontmatter; then
        _key="${line%%:*}"
        _val="${line#*: }"
        _key="$(echo "$_key" | tr -d '[:space:]')"
        _val="$(echo "$_val" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"

        case "$_key" in
          mode)       export SURREAL_MODE="$_val" ;;
          url)        export SURREAL_URL="$_val" ;;
          data_path)  export SURREAL_DATA_PATH="$_val" ;;
          username)   export SURREAL_USER="$_val" ;;
          password)   export SURREAL_PASS="$_val" ;;
          namespace)  export SURREAL_NS="$_val" ;;
          database)   export SURREAL_DB="$_val" ;;
        esac
      fi
    done < "$_cfg_path"
    break
  fi
done

# Derive HTTP endpoint for direct API calls from hooks
case "$SURREAL_MODE" in
  local)
    export SURREAL_HTTP_URL="${SURREAL_URL:-http://localhost:8000}"
    export SURREAL_HTTP_URL="${SURREAL_HTTP_URL/ws:\/\//http://}"
    export SURREAL_HTTP_URL="${SURREAL_HTTP_URL/wss:\/\//https://}"
    ;;
  remote)
    export SURREAL_HTTP_URL="${SURREAL_URL:-https://cloud.surrealdb.com}"
    export SURREAL_HTTP_URL="${SURREAL_HTTP_URL/wss:\/\//https://}"
    ;;
  *)
    # Embedded and memory modes don't have HTTP endpoints
    export SURREAL_HTTP_URL=""
    ;;
esac

# Cleanup temp vars
unset _cfg_path _in_frontmatter _key _val _CONFIG_SEARCH_PATHS

# MCP server location
MCP_DIR="${PLUGIN_ROOT}/mcp"
MCP_ENTRY="${MCP_DIR}/src/index.ts"

# Logging
LOG_DIR="${PLUGIN_ROOT}/hooks/scripts/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || true

log() {
  local level="$1"
  shift
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [${level}] $*" >> "${LOG_DIR}/hooks.log" 2>/dev/null || true
}

log_info()  { log "INFO"  "$@"; }
log_warn()  { log "WARN"  "$@"; }
log_error() { log "ERROR" "$@"; }
