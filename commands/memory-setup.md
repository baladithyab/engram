---
name: memory-setup
description: Interactive setup wizard for the SurrealDB memory system. Configures deployment mode, connection settings, and verifies connectivity.
---

Run the SurrealDB memory setup wizard. Walk the user through these steps:

## Step 1: Choose Deployment Mode

Ask which mode to use:

| Mode | Description | Best For |
|------|-------------|----------|
| `embedded` | SurrealKV file-based, zero config (default) | Single machine, getting started |
| `memory` | In-memory, ephemeral (snapshot on close) | Testing, CI, temporary sessions |
| `local` | Connect to local `surreal start` server | Shared dev environment, persistence with RocksDB |
| `remote` | Connect to SurrealDB Cloud or remote server | Team use, production |

## Step 2: Configure Connection

Based on the chosen mode:

- **embedded**: Ask for data path (default: `~/.claude/surrealdb-memory/data`)
- **memory**: No config needed (data path used for snapshot export)
- **local**: Ask for URL (default: `ws://localhost:8000`), username, password
- **remote**: Ask for URL, username, password, namespace, database

## Step 3: Write Configuration

Create `.claude/surrealdb-memory.local.md` in the project root with YAML frontmatter:

```markdown
---
mode: embedded
data_path: ~/.claude/surrealdb-memory/data
---

Local SurrealDB memory configuration. Not checked into git.
```

Remind the user to add `.claude/surrealdb-memory.local.md` to `.gitignore` if it contains credentials.

## Step 4: Verify Connection

Use the `get_memory_status` MCP tool to verify the connection works. Report:
- Connection status
- Deployment mode
- Memory and entity counts

If it fails, help troubleshoot:
- **embedded**: Check data path is writable
- **local**: Is `surreal start` running? Check `surreal start rocksdb://path`
- **remote**: Check URL, credentials, network access

## Step 5: Test Store/Recall Cycle

Store a test memory and recall it to verify the full pipeline:

1. `store_memory` with content "Setup verification test", type "working", scope "session"
2. `recall_memories` with query "setup verification"
3. `forget_memory` to clean up the test memory

Report success or failure for each step.
