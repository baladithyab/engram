---
name: memory-config
description: View or update the current SurrealDB memory configuration without the full setup wizard.
allowed-tools: ["get_memory_status"]
argument-hint: "[show|mode|path|url]"
---

# Memory Configuration

Quick configuration management for the surrealdb-memory plugin.

## If no argument or "show"

Read and display `.claude/surrealdb-memory.local.md` using the Read tool.
Show the current settings in a clean table format:

| Setting | Value |
|---------|-------|
| Mode | embedded |
| Data Path | ~/.claude/surrealdb-memory/data |
| ... | ... |

Also run `get_memory_status` to show live connection status and memory counts.

## If "mode" argument

Use `AskUserQuestion` to let the user switch deployment mode:
- Embedded (SurrealKV, zero-config)
- In-Memory (ephemeral + snapshots)
- Local Server (ws://localhost:8000)
- Remote (SurrealDB Cloud)

After selection, update the `mode` field in `.claude/surrealdb-memory.local.md` using Edit tool.
Warn that Claude Code restart is needed for hooks to pick up the change.

## If "path" argument

Use `AskUserQuestion` to change the data storage path:
- Default (~/.claude/surrealdb-memory/data/)
- Project-local (.claude/surrealdb-memory/data/)
- Custom path

Update `data_path` in `.claude/surrealdb-memory.local.md`.

## If "url" argument

Ask for the new SurrealDB URL. Update `url` in `.claude/surrealdb-memory.local.md`.
Only relevant for local/remote modes.

## After any change

Remind the user: "Restart Claude Code for the new settings to take effect in hooks."
