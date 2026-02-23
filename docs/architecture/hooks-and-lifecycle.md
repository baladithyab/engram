# Hooks and Lifecycle

> **Status:** Living document
> **Date:** 2026-02-23
> **See also:** [Overview](overview.md) | [Memory Model](memory-model.md) | [Knowledge Graph](knowledge-graph.md)
> **Research:** [docs/research/hooks-system-design.md](../research/hooks-system-design.md) | [docs/research/plugin-structure-design.md](../research/plugin-structure-design.md)

---

## Overview

Hooks are the mechanism that makes memory automatic. The user never needs to explicitly
say "remember this" or "recall that." Hook events fire at key lifecycle moments in a
Claude Code session to automatically capture, retrieve, and consolidate memories.

Explicit commands (`/remember`, `/recall`, `/forget`) exist for manual control but are
not required for the system to function.

---

## Design Principles

1. **Invisible by default.** The user never types "remember this." Hooks fire
   automatically at the right lifecycle moments.
2. **Never block the user.** Every hook has a timeout. Failures are swallowed silently
   (logged, not surfaced). Claude continues normally if memory is unavailable.
3. **Token budget discipline.** Injected context respects a configurable ceiling (default
   2000 tokens) to avoid crowding out the user's actual work.
4. **Read-heavy, write-light.** Reads happen on the hot path (SessionStart). Writes
   happen on the cool path (Stop, PreCompact) where latency matters less.
5. **Idempotent writes.** Storing the same memory twice produces no duplicates. SurrealDB
   `UPSERT` or content-hash dedup handles this.

---

## Hook Event Map

The plugin currently defines three hooks. The full design (in research) specifies
additional hooks for future phases.

### Current Implementation (Phase 1)

| Hook Event | Type | Timeout | Purpose |
|------------|------|---------|---------|
| `SessionStart` | command | 10s | Load project + user memories into context |
| `Stop` | prompt | 30s | Consolidate session learnings before exit |
| `PreCompact` | command | 15s | Save context before compaction discards it |

### Planned (Phase 2+)

| Hook Event | Type | Timeout | Purpose |
|------------|------|---------|---------|
| `UserPromptSubmit` | prompt | 5s | Silently query memory for context relevant to prompt |
| `PreToolUse (Read)` | prompt | 3s | Check memory for notes about the file being read |
| `PreToolUse (Write/Edit)` | prompt | 3s | Check memory for coding conventions for the file |
| `PreToolUse (Bash)` | prompt | 3s | Check memory for past outcomes of similar commands |
| `PreToolUse (Task)` | prompt | 5s | Inject relevant memories for subagent context |
| `PostToolUse (Write/Edit)` | command | 5s | Store file change as episodic memory |
| `PostToolUse (Bash)` | command | 5s | Store command outcome (especially errors) |

---

## SessionStart Hook

**Purpose:** Load relevant project and user memories into Claude's context at the
beginning of a session, so it starts with knowledge accumulated from past sessions.

**Current implementation** (`hooks/scripts/session-start.sh`):

```bash
#!/bin/bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_PATH="${SURREAL_DATA_PATH:-$HOME/.claude/surrealdb-memory/data}"

# Skip if no database exists yet
if [ ! -d "$DATA_PATH" ]; then
  exit 0
fi

# TODO: Query SurrealDB for project memories and output as system context
exit 0
```

**Full design (Phase 2):**

The session start hook will:
1. Query project-scoped memories with `status = 'active'`, ordered by `memory_strength DESC`
2. Query user-scoped memories relevant to the current project's tech stack
3. Format the top results (respecting the 2000-token budget) as a system note
4. Output them to stdout, which Claude Code injects into the conversation context

```bash
# Phase 2 implementation sketch
MEMORIES=$(curl -s "http://localhost:${SURREAL_PORT}/sql" \
  -H "Accept: application/json" \
  -d "SELECT content, memory_type, tags FROM memory
      WHERE scope = 'project' AND status = 'active'
      ORDER BY memory_strength DESC LIMIT 10")

if [ -n "$MEMORIES" ]; then
  echo "[Memory: Project Context]"
  echo "$MEMORIES" | jq -r '.[] | "- [\(.memory_type)] \(.content)"'
fi
```

**Effect:** Claude begins the session already knowing the codebase architecture,
past decisions, common errors, and team conventions -- without the user repeating
themselves.

---

## Stop Hook

**Purpose:** Consolidate session learnings before the conversation ends. This is where
the promotion pipeline runs, capturing valuable session knowledge into project scope.

**Current implementation** (`hooks/hooks.json`):

```json
{
  "type": "Stop",
  "hooks": [
    {
      "type": "prompt",
      "prompt": "Before ending this session, review what was accomplished and store key learnings as memories using the store_memory MCP tool. Focus on: (1) decisions made and their rationale, (2) patterns discovered in the codebase, (3) errors encountered and how they were fixed, (4) conventions learned. Store each as a separate memory with appropriate type (semantic for facts, procedural for patterns, episodic for events) and scope=project. Only store genuinely useful knowledge, not trivial operations."
    }
  ],
  "timeout": 30000
}
```

**How it works:**

1. Claude Code fires the `Stop` event when the session is ending.
2. The prompt instructs Claude to review the session and identify key learnings.
3. Claude calls `store_memory` MCP tool for each valuable insight, classifying by type:
   - **Semantic:** Facts discovered ("This project uses ESM modules")
   - **Procedural:** Patterns learned ("Run `bun test` before committing")
   - **Episodic:** Events that happened ("Fixed the CORS bug by adding origin header")
4. Memories are stored at `scope=project` so they persist for future sessions.
5. The `memory-consolidator` agent can later merge, deduplicate, and promote.

**What gets stored (examples):**

| Memory | Type | Tags |
|--------|------|------|
| "The auth module uses JWT tokens with 1-hour expiry stored in httpOnly cookies" | semantic | `[auth, jwt, cookies]` |
| "To fix CORS errors, check the allowed-origins list in config/cors.ts" | procedural | `[cors, debugging]` |
| "Migrated the user table from PostgreSQL to DynamoDB, keeping the old PG schema for read compatibility" | episodic | `[migration, database]` |

---

## PreCompact Hook

**Purpose:** Save critical context before Claude Code's automatic context compaction
discards it. Compaction summarizes and truncates the conversation to stay within the
context window, which can lose important details.

**Current implementation** (`hooks/scripts/pre-compact.sh`):

```bash
#!/bin/bash
set -uo pipefail

# TODO: Implement context preservation before compaction
# Full implementation will:
# 1. Read current conversation context
# 2. Store key points to SurrealDB via HTTP API
# 3. Ensure important context survives compaction
exit 0
```

**Full design (Phase 2):**

Before compaction fires, this hook will:
1. Identify key context that would be lost (recent decisions, active task state)
2. Store working-memory entries with high importance to ensure they survive
3. Update any active `working` type memories with current task state

This is particularly important for long sessions where compaction happens multiple
times. Without this hook, Claude loses track of earlier context.

---

## PostToolUse Hooks (Planned)

### After Write/Edit

Store file changes as episodic memories, capturing what was changed and why.

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "command",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/post-write.sh",
      "timeout": 5
    }
  ]
}
```

The script captures:
- File path that was modified
- Summary of the change
- Stored as `episodic` memory with `scope=session`
- Tagged with file path for later retrieval

### After Bash

Store command outcomes, especially errors and their resolutions.

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/post-bash.sh",
      "timeout": 5
    }
  ]
}
```

Failed commands are stored with higher importance, tagged with `debugging`. When the
same command is run in a future session, the `PreToolUse (Bash)` hook retrieves the
past failure and injects a warning.

---

## How Hooks Interact with MCP Tools

Hooks and MCP tools form a closed loop:

```
  Hooks fire automatically           MCP tools execute the work
  at lifecycle moments               against SurrealDB
┌─────────────────────┐          ┌─────────────────────────┐
│  SessionStart       │─────────>│  recall_memories        │
│  (load context)     │          │  (query project scope)  │
│                     │          │                         │
│  Stop               │─────────>│  store_memory           │
│  (persist learnings)│          │  (write to project)     │
│                     │          │  promote_memory         │
│  PreCompact         │─────────>│  store_memory           │
│  (save context)     │          │  (write working memory) │
│                     │          │                         │
│  PostToolUse        │─────────>│  store_memory           │
│  (capture outcomes) │          │  (write episodic)       │
│                     │          │                         │
│  PreToolUse         │─────────>│  recall_memories        │
│  (inject context)   │          │  (query for file/cmd)   │
└─────────────────────┘          └─────────────────────────┘
```

The hook types determine how this interaction works:

- **`command` hooks** run a shell script. The script can call the MCP server's HTTP API
  or use the SurrealDB CLI directly.
- **`prompt` hooks** inject a prompt into Claude's context. Claude then decides whether
  to call MCP tools based on the prompt instructions.

---

## Claudeception: Cross-Session Learning

The hook system creates a learning loop across sessions. This is sometimes called
"claudeception" -- one Claude session benefits from the learnings of previous sessions.

```
Session 1                    Session 2                    Session 3
─────────                    ─────────                    ─────────
Work on feature A            Work on feature B            Work on feature A again
    │                            │                            │
    ▼                            ▼                            ▼
Stop hook fires              SessionStart loads           SessionStart loads
    │                        Session 1 memories               │
    ▼                            │                        Session 1 + 2 memories
store_memory:                    ▼                            │
  "auth uses JWT"           Claude knows about JWT            ▼
  "config in /config/"      without being told            Claude knows all prior
  "run bun test"                │                         context from day 1
    │                            ▼                            │
    ▼                        Stop hook fires                  ▼
Memories persisted           store_memory:                 Richer context,
at project scope               "feature B pattern"        fewer repeated
                               "new convention"           explanations
```

Each session is an increment:
1. **Session N** produces learnings stored as project-scoped memories.
2. **Session N+1** loads those memories at start, so Claude begins with accumulated knowledge.
3. Over time, the project memory builds a comprehensive model of the codebase.

---

## Memory Lifecycle Through Hooks

Hooks ensure memories are created, accessed, consolidated, and pruned at the right
moments:

| Lifecycle Stage | Responsible Hook | What Happens |
|----------------|-----------------|--------------|
| **Creation** | Stop, PostToolUse | New memories created from session activity |
| **Retrieval** | SessionStart, PreToolUse, UserPromptSubmit | Memories recalled and injected into context |
| **Strengthening** | (automatic on retrieval) | `access_count` incremented, `last_accessed_at` updated |
| **Consolidation** | Stop (via memory-consolidator) | Similar memories merged, episodic compressed to semantic |
| **Promotion** | Stop | Session memories meeting criteria promoted to project scope |
| **Pruning** | (SurrealDB DEFINE EVENT) | Low-strength memories archived, then forgotten |

The full memory lifecycle state machine is documented in [Memory Model](memory-model.md).

---

## hooks.json Reference

The current `hooks/hooks.json` configuration:

```json
{
  "hooks": [
    {
      "type": "SessionStart",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.sh",
      "timeout": 10000
    },
    {
      "type": "Stop",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Before ending this session, review what was accomplished and store key learnings as memories using the store_memory MCP tool. Focus on: (1) decisions made and their rationale, (2) patterns discovered in the codebase, (3) errors encountered and how they were fixed, (4) conventions learned. Store each as a separate memory with appropriate type (semantic for facts, procedural for patterns, episodic for events) and scope=project. Only store genuinely useful knowledge, not trivial operations."
        }
      ],
      "timeout": 30000
    },
    {
      "type": "PreCompact",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/pre-compact.sh",
      "timeout": 15000
    }
  ]
}
```

### Hook Execution Model

Claude Code runs all matching hooks **in parallel** within each event. Hooks within the
same matcher array run concurrently, not sequentially. This means:

- Hooks cannot depend on each other's output within the same event.
- The fastest hook's output appears first; others append.
- A slow hook does not delay a fast hook (up to the timeout).
- If a hook exceeds its timeout, it is killed and the session continues normally.
