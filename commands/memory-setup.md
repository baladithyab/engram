---
name: memory-setup
description: Interactive setup wizard for the SurrealDB memory system. Auto-detects environment, configures deployment mode, and verifies connectivity.
allowed-tools: ["get_memory_status", "store_memory", "recall_memories", "forget_memory"]
argument-hint: "[embedded|local|docker|remote|memory]"
---

# SurrealDB Memory Setup Wizard

Run the interactive setup wizard for the surrealdb-memory plugin.

## Step 1: Detect Environment

Before asking the user anything, auto-detect what's available:

1. Check if `.claude/surrealdb-memory.local.md` already exists — if so, read current config
2. Check if SurrealDB is installed: `which surreal` or `surreal version`
3. Check if Docker is available: `which docker` and `docker info --format '{{.ServerVersion}}'`
4. Check if a local SurrealDB is already running: `curl -s http://localhost:8000/health`
5. Check if the data directory exists: `ls ~/.claude/surrealdb-memory/data/`

Report findings to the user before asking for their choice.

## Step 2: Choose Deployment Mode

Use `AskUserQuestion` to present deployment options. Recommend based on detection:
- If nothing special detected → recommend **embedded** (zero config)
- If Docker is available → offer **docker** as an option
- If surreal binary is installed → offer **local** as an option
- If a SurrealDB instance is already running → offer to connect to it

Present the question with these options:

**Question:** "How should the memory system store data?"
**Options:**
1. **Embedded (Recommended)** — Zero config, data persists at ~/.claude/surrealdb-memory/data/. No separate process needed.
2. **In-Memory** — Fast and ephemeral. Data exported to snapshot on session end. Good for testing.
3. **Local Server** — Connect to a local `surreal start` process. Choose if you want Surrealist GUI access.
4. **Remote** — Connect to SurrealDB Cloud or a self-hosted instance. For teams and multi-machine.

If the user provided a mode as an argument, skip this step and use that mode.

## Step 3: Mode-Specific Configuration

Based on chosen mode, ask follow-up questions using `AskUserQuestion`:

**Embedded/In-Memory:**
- Ask: "Where should memory data be stored?"
  - Option 1: Default (~/.claude/surrealdb-memory/data/) (Recommended)
  - Option 2: Project-local (.claude/surrealdb-memory/data/)
  - Option 3: Custom path

**Local:**
- Ask: "What's the SurrealDB server URL?"
  - Option 1: Default (ws://localhost:8000) (Recommended)
  - Option 2: Custom URL
- Ask: "Authentication credentials?"
  - Option 1: Default (root/root) (Recommended)
  - Option 2: Custom credentials

**Remote:**
- Ask for URL (required)
- Ask for namespace and database
- Ask for credentials

## Step 4: Write Configuration

Create `.claude/surrealdb-memory.local.md` using the Write tool:

```markdown
---
mode: {chosen_mode}
data_path: {chosen_path}
url: {chosen_url}           # only for local/remote
username: {chosen_username}  # only for local/remote
password: {chosen_password}  # only for local/remote
namespace: memory
database: default
---

# SurrealDB Memory Configuration

Configured by /memory-setup on {current_date}.
Mode: {chosen_mode}

Edit the YAML frontmatter above to change settings.
Restart Claude Code after changes for hooks to pick up new config.
```

Also check if `.gitignore` contains `.claude/*.local.md` — if not, suggest adding it
(especially if mode is remote with credentials).

## Step 5: Verify Connection

Use the `get_memory_status` MCP tool to verify:
- Connection established
- Schema initialized
- Report mode, memory count, entity count

If it fails, provide mode-specific troubleshooting:
- **embedded**: Check data path permissions, disk space
- **local**: Is `surreal start` running? Try `surreal start rocksdb://path`
- **remote**: Check URL, credentials, network/firewall

## Step 6: Test Round-Trip

Run a quick test cycle:
1. `store_memory` — content: "Memory system configured successfully", type: "semantic", scope: "project", importance: 0.3
2. `recall_memories` — query: "memory system configured"
3. Verify the memory was found
4. `forget_memory` — clean up the test

Report success. Tell the user:
- "Memory is active. Use `/remember` to store knowledge and `/recall` to search."
- "The Stop hook will automatically save session learnings when you end a conversation."
- "Run `/memory-status` anytime to check the system."
