#!/bin/bash
# PostToolUse hook: fires after Bash tool returns non-zero exit code.
# Logs errors for potential memory storage as episodic memories.
# Arguments: $1=tool_input (JSON), $2=tool_output

source "$(dirname "$0")/config.sh" 2>/dev/null || true

TOOL_INPUT="${1:-}"
TOOL_OUTPUT="${2:-}"

# Extract command from tool input (best-effort)
COMMAND=""
if command -v jq &>/dev/null && [ -n "$TOOL_INPUT" ]; then
  COMMAND=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null)
fi

if [ -n "$COMMAND" ]; then
  # Truncate long output for the log
  SHORT_OUTPUT=$(echo "$TOOL_OUTPUT" | head -c 500)
  log_warn "Bash error: ${COMMAND} -> ${SHORT_OUTPUT}"
fi

# Non-critical — always exit 0 so we don't block the session
exit 0
