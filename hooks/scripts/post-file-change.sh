#!/bin/bash
# PostToolUse hook: fires after Write or Edit tool use.
# Logs file changes for potential memory storage.
# Arguments: $1=tool_name, $2=tool_input (JSON)

source "$(dirname "$0")/config.sh" 2>/dev/null || true

TOOL_NAME="${1:-unknown}"
TOOL_INPUT="${2:-}"

# Extract file path from tool input JSON (best-effort)
FILE_PATH=""
if command -v jq &>/dev/null && [ -n "$TOOL_INPUT" ]; then
  FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // .path // empty' 2>/dev/null)
fi

if [ -n "$FILE_PATH" ]; then
  log_info "File changed via ${TOOL_NAME}: ${FILE_PATH}"
fi

# Non-critical — always exit 0 so we don't block the session
exit 0
