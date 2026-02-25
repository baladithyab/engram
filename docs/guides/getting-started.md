# Getting Started

Quick start guide for the engram Claude Code plugin.

## Prerequisites

- **Bun 1.3+** -- install via `brew install bun` or `curl -fsSL https://bun.sh/install | bash`
- **Claude Code** -- the plugin requires Claude Code with plugin support

SurrealDB is NOT needed as a separate install. The default embedded mode (SurrealKV)
bundles the database engine directly via the `surrealdb` npm package.

## Installation

Clone or copy the plugin, then install MCP server dependencies:

```bash
git clone <repo-url> engram
cd engram/mcp
bun install
```

That's it. No database setup, no Docker, no config files.

## Launch Claude Code with the Plugin

Point Claude Code at the plugin directory:

```bash
claude --plugin-dir /path/to/engram
```

On first launch, the MCP server starts an embedded SurrealKV database at
`~/.claude/engram/data`. This persists across sessions automatically.

## Verify it Works

Run the `/memory-status` command inside Claude Code:

```
> /memory-status
```

You should see output like:

```json
{
  "connected": true,
  "mode": "embedded",
  "memoryCount": 0,
  "entityCount": 0
}
```

If `connected` is `true`, the plugin is working.

## First Use: Storing Memories

### /remember -- Store knowledge

Store something manually:

```
> /remember The API uses JWT tokens with 1-hour expiry, refreshed via /auth/refresh
```

Claude will determine the appropriate type, scope, tags, and importance, then
persist it via the `store_memory` MCP tool. You can also run `/remember` without
arguments and Claude will ask what to store.

### /recall -- Search memories

Retrieve stored knowledge:

```
> /recall authentication tokens
```

Results include content, type, scope, creation date, tags, and a BM25 relevance
score. If nothing matches, Claude will suggest broadening your search terms.

### /forget -- Remove memories

Find and soft-delete a memory:

```
> /forget old database credentials
```

Claude first searches for matches, shows what it found, and asks you to confirm
before marking any memories as forgotten. Forgotten memories are archived, not
permanently deleted.

### /memory-status -- Check the system

```
> /memory-status
```

Shows connection status, deployment mode, and memory/entity counts.

## How Automatic Hooks Work

The plugin registers three hooks that fire automatically:

| Hook | When | What it does |
|------|------|-------------|
| **SessionStart** | Conversation begins | Loads relevant project memories into context (placeholder in MVP) |
| **Stop** | Conversation ends | Reviews what was accomplished and stores key learnings as memories |
| **PreCompact** | Before context compaction | Preserves important context that would otherwise be lost (placeholder in MVP) |

The **Stop hook** is the most active in the MVP. When a session ends, Claude
reviews decisions made, patterns discovered, errors fixed, and conventions learned,
then stores each as a separate memory with appropriate type and scope.

This means you can work normally and the plugin captures useful knowledge in the
background. Future sessions benefit from what previous sessions learned.

## Default Configuration

Out of the box, the plugin uses:

| Setting | Default |
|---------|---------|
| Mode | Embedded SurrealKV |
| Data path | `~/.claude/engram/data` |
| Username | `root` |
| Password | `root` |
| Namespace | `memory` |
| Database | `default` |

No configuration file is needed for the defaults. To customize, see the
[Configuration Guide](configuration.md).

## What to Remember

Not everything needs to be stored. Good candidates:

- **Decisions and rationale** -- "We chose PostgreSQL over MySQL because of jsonb support"
- **Codebase conventions** -- "All API endpoints use camelCase, database columns use snake_case"
- **Error resolutions** -- "CORS errors on /api/users were fixed by adding the origin to allowed-origins.ts"
- **Deployment procedures** -- "Deploy to staging with `cdk deploy --context env=staging`"

Skip trivial things like "I ran ls" or "the file has 200 lines."

See [Memory Best Practices](memory-best-practices.md) for detailed guidance.

## Next Steps

- [Configuration Guide](configuration.md) -- customize deployment mode, credentials, behavior
- [Memory Best Practices](memory-best-practices.md) -- what to remember, types, scopes, importance
- [Deployment Modes](deployment-modes.md) -- embedded, in-memory, local server, Docker, remote
- [Developer Guide](developing.md) -- contribute to the plugin
