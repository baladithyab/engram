# Plugin Structure and Components

> Design document for the `engram` Claude Code plugin — directory layout,
> manifest, commands, skills, agents, hooks, MCP server, and configuration discovery.

## Directory Structure

```
engram/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── .mcp.json                    # MCP server definition
├── commands/
│   ├── remember.md              # /remember — manually store a memory
│   ├── recall.md                # /recall — search and retrieve memories
│   ├── forget.md                # /forget — delete memories
│   ├── memory-status.md         # /memory-status — connection + stats
│   └── memory-setup.md          # /memory-setup — configure deployment mode
├── agents/
│   ├── memory-consolidator.md   # Background memory maintenance
│   └── memory-reviewer.md       # Review and curate memories
├── skills/
│   ├── memory-query/
│   │   ├── SKILL.md             # How to query and use memories
│   │   └── references/
│   │       ├── surql-patterns.md    # SurrealQL query patterns
│   │       └── relevance-scoring.md # How relevance is calculated
│   ├── memory-admin/
│   │   ├── SKILL.md             # Memory lifecycle management
│   │   └── references/
│   │       └── retention-policies.md
│   └── memory-setup/
│       ├── SKILL.md             # Deployment configuration guide
│       └── references/
│           └── deployment-modes.md
├── hooks/
│   ├── hooks.json               # Hook definitions
│   └── scripts/
│       ├── session-start.sh     # Load relevant memories
│       ├── session-end.sh       # Persist session learnings
│       ├── pre-compact.sh       # Save context before compaction
│       └── post-tool.sh         # Store tool outcomes
├── mcp/
│   ├── package.json
│   ├── server.js                # MCP server entry point
│   └── src/
│       ├── tools.js             # MCP tool definitions
│       ├── resources.js         # MCP resource definitions
│       └── surrealdb-client.js  # SurrealDB connection wrapper
├── scripts/
│   └── health-check.sh          # Verify SurrealDB connectivity
└── README.md
```

**Key conventions followed:**

- `.claude-plugin/plugin.json` at canonical location
- All component directories (`commands/`, `agents/`, `skills/`, `hooks/`) at plugin root
- Kebab-case naming throughout
- Skills in subdirectories with `SKILL.md`
- MCP server defined in `.mcp.json` at plugin root
- `${CLAUDE_PLUGIN_ROOT}` used for all intra-plugin path references

---

## Plugin Manifest — `plugin.json`

```json
{
  "name": "engram",
  "version": "0.1.0",
  "description": "Hierarchical, self-evolving memory for Claude Code sessions backed by SurrealDB",
  "author": {
    "name": "baladita"
  },
  "license": "MIT",
  "keywords": [
    "memory",
    "surrealdb",
    "persistence",
    "context",
    "knowledge-graph"
  ],
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

**Notes:**

- `commands/`, `agents/`, `skills/` use auto-discovery from default directories — no explicit paths needed in manifest.
- `hooks` and `mcpServers` are pointed to their dedicated files to keep the manifest lean.

---

## MCP Server Definition — `.mcp.json`

```json
{
  "engram": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.js"],
    "env": {
      "SURREAL_ENDPOINT": "${SURREAL_ENDPOINT:-ws://127.0.0.1:8000}",
      "SURREAL_NAMESPACE": "${SURREAL_NAMESPACE:-claude_memory}",
      "SURREAL_DATABASE": "${SURREAL_DATABASE:-memory}",
      "SURREAL_USER": "${SURREAL_USER:-root}",
      "SURREAL_PASS": "${SURREAL_PASS:-root}"
    }
  }
}
```

The MCP server exposes the core memory operations as tools and the memory hierarchy as resources. Connection details are injected via environment variables with sane defaults for local development. See [[MCP Server Design]] for full tool and resource specifications.

---

## Commands

### `/remember` — Manually Store a Memory

**File:** `commands/remember.md`

```yaml
---
description: Store a memory — insight, decision, pattern, or fact — into the knowledge graph
argument-hint: [content-to-remember]
allowed-tools:
  - mcp__plugin_engram_engram__memory_store
  - mcp__plugin_engram_engram__memory_search
---
```

**Behavior:**

1. Parse `$ARGUMENTS` for the memory content to store.
2. If content is vague, use `AskUserQuestion` to clarify what exactly to remember and at which scope (user / project / session).
3. Call `memory_search` to check for duplicate or near-duplicate memories.
4. If a related memory exists, ask whether to update the existing memory or create a new one.
5. Call `memory_store` with the content, inferred tags, and scope.
6. Confirm what was stored and how it connects to existing knowledge.

### `/recall` — Search and Retrieve Memories

**File:** `commands/recall.md`

```yaml
---
description: Search the memory graph for relevant knowledge — semantic, tag, or graph traversal
argument-hint: [query]
allowed-tools:
  - mcp__plugin_engram_engram__memory_search
  - mcp__plugin_engram_engram__memory_traverse
  - Read
---
```

**Behavior:**

1. Parse `$ARGUMENTS` as the search query.
2. Call `memory_search` with the query (combines vector similarity + keyword + tag matching).
3. If results are sparse, use `memory_traverse` to follow graph edges from the best-matching nodes.
4. Present results grouped by scope (user > project > session) with relevance scores.
5. If no results, suggest related queries or offer to store new knowledge.

### `/forget` — Delete Memories

**File:** `commands/forget.md`

```yaml
---
description: Delete specific memories or purge a scope
argument-hint: [memory-id or scope]
allowed-tools:
  - mcp__plugin_engram_engram__memory_search
  - mcp__plugin_engram_engram__memory_delete
---
```

**Behavior:**

1. Parse `$ARGUMENTS` — could be a memory ID, a search query, or a scope keyword (`session`, `project`, `user`).
2. If a search query, call `memory_search` and present matching memories for confirmation.
3. Use `AskUserQuestion` to confirm deletion — show what will be deleted.
4. Call `memory_delete` with confirmed IDs.
5. Report what was deleted and any orphaned graph edges that were cleaned up.

### `/memory-status` — Show Connection and Stats

**File:** `commands/memory-status.md`

```yaml
---
description: Show SurrealDB connection status, memory counts, and storage statistics
allowed-tools:
  - mcp__plugin_engram_engram__memory_stats
  - mcp__plugin_engram_engram__health_check
---
```

**Behavior:**

1. Call `health_check` to verify SurrealDB connectivity.
2. Call `memory_stats` to get counts by scope, type, and age.
3. Display a formatted status table:
   - Connection status (endpoint, namespace, database)
   - Deployment mode (embedded / local / cloud)
   - Memory counts by scope (user / project / session)
   - Memory counts by type (insight / decision / pattern / fact / preference)
   - Storage size and oldest/newest memory timestamps
   - Evolution stats (promotions, consolidations, decays)

### `/memory-setup` — Configure Deployment Mode

**File:** `commands/memory-setup.md`

```yaml
---
description: Configure SurrealDB deployment — embedded, local Docker, or cloud — and write settings
argument-hint: [embedded|local|cloud]
allowed-tools:
  - Read
  - Write
  - Bash(docker:*, surreal:*, curl:*)
  - mcp__plugin_engram_engram__health_check
---
```

**Behavior:**

1. Check for existing settings at `.claude/engram.local.md`.
2. If `$1` provided, use it as the deployment mode; otherwise use `AskUserQuestion` to present the three options with trade-offs:
   - **embedded** — SurrealDB in-memory via Rust WASM, no external dependencies, data persists to a RocksDB file
   - **local** — SurrealDB in Docker container, shared across projects, persistent
   - **cloud** — SurrealDB Cloud or self-hosted remote instance, shared across machines
3. For each mode, validate prerequisites:
   - embedded: check that SurrealDB binary is available
   - local: check Docker is running, offer to pull `surrealdb/surrealdb` image
   - cloud: prompt for endpoint URL and credentials
4. Write `.claude/engram.local.md` with the chosen configuration.
5. Call `health_check` to verify the new connection works.
6. Report success and remind to restart Claude Code for hooks to pick up new settings.

---

## Skills

### `memory-query` — How to Query and Use Memories

**File:** `skills/memory-query/SKILL.md`

```yaml
---
name: memory-query
description: >
  This skill should be used when the user asks to "search memories",
  "find what I said about", "recall previous decisions", "look up past context",
  "query the knowledge graph", "find related memories", or when Claude needs
  to retrieve stored knowledge to inform a response. Provides guidance on
  constructing effective memory queries using semantic search, tag filtering,
  graph traversal, and scope-aware retrieval.
version: 0.1.0
---
```

**SKILL.md content outline:**

- **Overview** — When and why to query memories; the three retrieval modes (semantic, tag, graph)
- **Query Construction** — How to build effective queries:
  - Semantic search: natural language queries matched against memory embeddings
  - Tag filtering: exact-match on tags (e.g., `#architecture`, `#decision`)
  - Graph traversal: follow `RELATES_TO`, `SUPERSEDES`, `DERIVED_FROM` edges
  - Scope filtering: restrict to user / project / session level
- **Relevance Scoring** — How results are ranked (vector distance + recency + access frequency + scope priority); pointer to `references/relevance-scoring.md`
- **Common Patterns** — Pre-built query patterns for:
  - "What decisions have we made about X?"
  - "What patterns have been observed in this codebase?"
  - "What does the user prefer for Y?"
- **MCP Tools Reference** — Quick reference for `memory_search` and `memory_traverse` tool parameters
- **Additional Resources** — Pointers to `references/surql-patterns.md` and `references/relevance-scoring.md`

### `memory-admin` — Memory Lifecycle Management

**File:** `skills/memory-admin/SKILL.md`

```yaml
---
name: memory-admin
description: >
  This skill should be used when the user asks to "clean up memories",
  "merge duplicate memories", "promote a memory", "manage memory retention",
  "archive old memories", "consolidate knowledge", or when performing
  maintenance on the memory graph. Provides guidance on memory lifecycle
  operations including promotion, consolidation, decay, and archival.
version: 0.1.0
---
```

**SKILL.md content outline:**

- **Overview** — The memory lifecycle: creation -> access -> evolution -> archival/deletion
- **Promotion** — Moving memories up the hierarchy (session -> project -> user) based on reuse frequency and cross-session relevance
- **Consolidation** — Merging related memories into unified entries; deduplication strategies
- **Decay** — Time-based and access-based decay; how importance scores decrease over time
- **Archival** — When memories are archived vs deleted; retrieval of archived memories
- **Retention Policies** — Configurable rules per scope; pointer to `references/retention-policies.md`
- **MCP Tools Reference** — Quick reference for `memory_delete`, `memory_update`, `memory_store` with lifecycle flags
- **Additional Resources** — Pointer to `references/retention-policies.md`

### `memory-setup` — Deployment Configuration Guide

**File:** `skills/memory-setup/SKILL.md`

```yaml
---
name: memory-setup
description: >
  This skill should be used when the user asks to "set up memory",
  "configure SurrealDB", "switch deployment mode", "connect to SurrealDB Cloud",
  "run SurrealDB locally", "use embedded SurrealDB", "troubleshoot memory connection",
  or needs guidance on deploying and configuring the SurrealDB backend for the
  memory plugin. Covers embedded, local Docker, and cloud deployment modes.
version: 0.1.0
---
```

**SKILL.md content outline:**

- **Overview** — Three deployment modes and when to use each
- **Embedded Mode** — In-process SurrealDB with RocksDB persistence; zero external dependencies; single-machine only
- **Local Mode** — Docker-based SurrealDB; shared across projects on same machine; persistent volumes
- **Cloud Mode** — SurrealDB Cloud or self-hosted remote; shared across machines; requires credentials
- **Configuration File** — Structure of `.claude/engram.local.md`; all available settings
- **Migration Between Modes** — How to export/import memories when switching deployment modes
- **Troubleshooting** — Common connection issues, authentication failures, Docker problems
- **Additional Resources** — Pointer to `references/deployment-modes.md`

---

## Agents

### `memory-consolidator` — Background Memory Maintenance

**File:** `agents/memory-consolidator.md`

```yaml
---
name: memory-consolidator
description: >
  Use this agent when the memory graph needs maintenance — deduplication,
  consolidation of related memories, promotion of frequently-accessed
  session memories to project level, and decay of stale entries. Examples:

  <example>
  Context: User has been working on a project for weeks with many session memories accumulated
  user: "My memory seems cluttered, can you clean it up?"
  assistant: "I'll consolidate and organize the memory graph."
  <commentary>
  Explicit request to clean up memories. Launch memory-consolidator to
  deduplicate, merge related entries, and promote valuable session memories.
  </commentary>
  </example>

  <example>
  Context: Memory status shows high count of session-level memories with many duplicates
  user: "/memory-status"
  assistant: "There are 847 session memories with potential duplicates. Let me consolidate them."
  <commentary>
  Proactively trigger consolidation when memory stats show excessive
  session-level entries that likely contain redundant information.
  </commentary>
  </example>

  <example>
  Context: After a long coding session with many tool calls
  user: "I'm done for today, wrap things up"
  assistant: "I'll consolidate today's session memories before closing."
  <commentary>
  End-of-session is a natural consolidation point. Merge related
  session memories and promote valuable ones before they accumulate.
  </commentary>
  </example>

model: inherit
color: yellow
tools:
  - mcp__plugin_engram_engram__memory_search
  - mcp__plugin_engram_engram__memory_store
  - mcp__plugin_engram_engram__memory_update
  - mcp__plugin_engram_engram__memory_delete
  - mcp__plugin_engram_engram__memory_traverse
  - mcp__plugin_engram_engram__memory_stats
  - Read
  - Grep
---
```

**System prompt (body):**

```
You are a memory maintenance agent responsible for keeping the knowledge graph
clean, organized, and valuable.

**Your Core Responsibilities:**
1. Identify and merge duplicate or near-duplicate memories
2. Consolidate related memories into unified, richer entries
3. Promote frequently-accessed session memories to project or user scope
4. Apply decay to stale memories that haven't been accessed
5. Clean up orphaned graph edges
6. Report what was changed

**Consolidation Process:**
1. Use memory_stats to understand current state
2. Use memory_search with broad queries to find clusters of related memories
3. Use memory_traverse to map relationships between memories
4. For each cluster of related memories:
   a. Identify the core insight across all related memories
   b. Create a consolidated memory that captures the full picture
   c. Link the consolidated memory to any memories it replaces
   d. Delete redundant entries, preserving the consolidated version
5. For frequently-accessed session memories (access_count > 3):
   a. Check if equivalent knowledge exists at project level
   b. If not, promote by creating a project-level memory
   c. Mark the session-level original as superseded
6. Report: memories consolidated, promoted, decayed, deleted

**Quality Standards:**
- Never delete without creating a consolidation first
- Preserve all unique information during merges
- Maintain graph connectivity — no orphaned edges
- Log every change for auditability

**Output Format:**
## Consolidation Report
- Memories scanned: [count]
- Duplicates merged: [count] (list IDs)
- Clusters consolidated: [count]
- Promoted to project: [count]
- Decayed/archived: [count]
- Edges cleaned: [count]
```

### `memory-reviewer` — Review and Curate Memories

**File:** `agents/memory-reviewer.md`

```yaml
---
name: memory-reviewer
description: >
  Use this agent when the user wants to review, curate, or audit the
  contents of the memory graph — understanding what is stored, verifying
  accuracy, correcting outdated information, and ensuring quality. Examples:

  <example>
  Context: User wants to understand what the memory system knows
  user: "What do you remember about this project?"
  assistant: "Let me review the project-level memories."
  <commentary>
  User is asking for a curated summary of stored knowledge. Launch
  memory-reviewer to present organized, verified memories.
  </commentary>
  </example>

  <example>
  Context: User suspects outdated information is being used
  user: "I think some of your memories are wrong, we changed the API last week"
  assistant: "I'll audit the memories related to the API and update any outdated ones."
  <commentary>
  User identified potentially stale memories. Launch memory-reviewer
  to find and correct outdated entries.
  </commentary>
  </example>

model: inherit
color: cyan
tools:
  - mcp__plugin_engram_engram__memory_search
  - mcp__plugin_engram_engram__memory_update
  - mcp__plugin_engram_engram__memory_traverse
  - mcp__plugin_engram_engram__memory_stats
  - Read
  - Grep
  - Glob
---
```

**System prompt (body):**

```
You are a memory curator responsible for reviewing, verifying, and
improving the quality of stored memories.

**Your Core Responsibilities:**
1. Present organized summaries of stored memories by scope and topic
2. Identify outdated or incorrect memories by cross-referencing with current code
3. Correct inaccurate memories and update stale information
4. Flag memories that need user verification
5. Suggest memories that should be created based on current project state

**Review Process:**
1. Use memory_stats to understand the memory landscape
2. Use memory_search to retrieve memories for the requested topic/scope
3. For each memory, assess:
   a. Accuracy: Does it match current code/project state?
   b. Relevance: Is it still useful?
   c. Completeness: Is important context missing?
   d. Freshness: When was it last accessed or updated?
4. Cross-reference with codebase using Read, Grep, Glob
5. Update memories that are inaccurate
6. Flag memories that need user input to verify
7. Present findings in organized format

**Quality Standards:**
- Never silently delete memories — always explain changes
- Preserve original memory content in update notes
- Distinguish between "verified accurate" and "needs verification"
- Present memories in order of relevance and confidence

**Output Format:**
## Memory Review: [Topic/Scope]

### Verified Memories
- [memory] — Last verified: [date], Confidence: high

### Updated Memories
- [memory] — Changed: [what changed and why]

### Needs Verification
- [memory] — Concern: [why it might be outdated]

### Suggested New Memories
- [suggestion] — Based on: [evidence from codebase]
```

---

## Hooks

### `hooks.json`

```json
{
  "description": "Automatic memory lifecycle hooks for engram plugin",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.sh",
            "timeout": 15
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-end.sh",
            "timeout": 30
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/pre-compact.sh",
            "timeout": 20
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/post-tool.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### Hook Designs

#### `session-start.sh` — Load Relevant Memories

**Event:** `SessionStart` | **Matcher:** `*` | **Timeout:** 15s

**Behavior:**

1. Read `.claude/engram.local.md` — quick-exit if missing or `enabled: false`.
2. Parse connection settings from frontmatter.
3. Call the MCP server's `memory_search` tool (via the SurrealDB client) with:
   - Current working directory (to identify project scope)
   - Recent file names from `git log --name-only -10` (if in a git repo)
4. Format the top 10 most relevant memories as a system message.
5. Output JSON with `systemMessage` containing the preloaded memories so Claude starts the session with relevant context.
6. Persist session ID to `$CLAUDE_ENV_FILE` for later hooks.

**Output structure:**
```json
{
  "systemMessage": "## Relevant Memories\n\n[formatted memories]",
  "continue": true
}
```

#### `session-end.sh` — Persist Session Learnings

**Event:** `SessionEnd` | **Matcher:** `*` | **Timeout:** 30s

**Behavior:**

1. Quick-exit if settings file missing or disabled.
2. Read the session transcript from `$transcript_path` (provided in hook input).
3. Extract key decisions, insights, and patterns from the session:
   - Files modified and why
   - Errors encountered and resolutions
   - Architectural decisions made
   - User preferences expressed
4. For each extracted memory, call `memory_store` at session scope.
5. Trigger a lightweight consolidation — check if any new session memories duplicate existing project-level memories.

#### `pre-compact.sh` — Save Context Before Compaction

**Event:** `PreCompact` | **Matcher:** `*` | **Timeout:** 20s

**Behavior:**

1. Quick-exit if settings file missing or disabled.
2. Read the session transcript to identify information that will be lost during compaction.
3. Extract and store:
   - Active task context (what we're working on and current state)
   - Decisions made in the conversation so far
   - Important code references and file paths discussed
4. Output a `systemMessage` reminding Claude to check memories after compaction for any context that was preserved.

**Output structure:**
```json
{
  "systemMessage": "Context saved to memory before compaction. After compaction, use /recall to retrieve preserved context.",
  "continue": true
}
```

#### `post-tool.sh` — Store Tool Outcomes

**Event:** `PostToolUse` | **Matcher:** `Write|Edit|Bash` | **Timeout:** 10s

**Behavior:**

1. Quick-exit if settings file missing or disabled.
2. Read hook input JSON from stdin — contains `tool_name`, `tool_input`, `tool_result`.
3. Filter for significant outcomes worth remembering:
   - **Write/Edit:** Record file modifications with brief context (file path + what changed)
   - **Bash:** Record command outcomes only for significant operations (build failures, test results, deployment status) — skip trivial commands like `ls`, `cat`, `pwd`
4. If significant, store as a lightweight session-scoped memory with tags derived from the tool name and file path.
5. Rate-limit: track a counter in a temp file, skip if > 50 memories stored this session (prevent runaway storage).

**Significance filter (Bash):**
- Commands matching `test|build|deploy|install|migrate|docker` are significant
- Commands matching `ls|cat|pwd|echo|head|tail|wc` are skipped
- Exit code != 0 is always significant (error patterns)

---

## Configuration Discovery

The plugin discovers user configuration from `.claude/engram.local.md` in the project root. This file uses YAML frontmatter for structured settings and a markdown body for additional context.

### Settings File Template

```markdown
---
enabled: true
deployment_mode: embedded
surreal_endpoint: ws://127.0.0.1:8000
surreal_namespace: claude_memory
surreal_database: memory
surreal_user: root
surreal_pass: root
auto_store: true
auto_recall: true
max_session_memories: 200
consolidation_threshold: 50
decay_after_days: 30
embedding_model: local
---

# SurrealDB Memory Configuration

Plugin is active in **embedded** mode.

## Notes
- Change `deployment_mode` to `local` or `cloud` and run `/memory-setup` to reconfigure.
- Set `auto_store: false` to disable automatic memory capture from hooks.
- Set `auto_recall: false` to disable automatic memory loading at session start.
```

### Settings Schema

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Master switch for the plugin |
| `deployment_mode` | string | `embedded` | One of: `embedded`, `local`, `cloud` |
| `surreal_endpoint` | string | `ws://127.0.0.1:8000` | SurrealDB WebSocket endpoint |
| `surreal_namespace` | string | `claude_memory` | SurrealDB namespace |
| `surreal_database` | string | `memory` | SurrealDB database name |
| `surreal_user` | string | `root` | SurrealDB username |
| `surreal_pass` | string | `root` | SurrealDB password |
| `auto_store` | boolean | `true` | Enable PostToolUse and SessionEnd hooks |
| `auto_recall` | boolean | `true` | Enable SessionStart memory preloading |
| `max_session_memories` | integer | `200` | Cap on session-scoped memories per session |
| `consolidation_threshold` | integer | `50` | Trigger consolidation when session count exceeds this |
| `decay_after_days` | integer | `30` | Days of inactivity before memory begins to decay |
| `embedding_model` | string | `local` | Embedding model for vector search (`local` or `bedrock`) |

### Discovery Flow

Every hook script follows this pattern:

```bash
#!/bin/bash
set -euo pipefail

STATE_FILE="$CLAUDE_PROJECT_DIR/.claude/engram.local.md"

# Quick exit if not configured
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# Parse frontmatter
FRONTMATTER=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$STATE_FILE")

# Check master switch
ENABLED=$(echo "$FRONTMATTER" | grep '^enabled:' | sed 's/enabled: *//')
if [[ "$ENABLED" != "true" ]]; then
  exit 0
fi

# Extract settings as needed
DEPLOYMENT_MODE=$(echo "$FRONTMATTER" | grep '^deployment_mode:' | sed 's/deployment_mode: *//')
ENDPOINT=$(echo "$FRONTMATTER" | grep '^surreal_endpoint:' | sed 's/surreal_endpoint: *//')
# ... etc

# Hook-specific logic follows
```

The `/memory-setup` command creates this file. All other components (hooks, commands, agents) read it. The `.claude/*.local.md` files are user-local and should be in `.gitignore`.

---

## Component Interaction Map

```
┌──────────────┐     SessionStart     ┌──────────────────┐
│  Hook:       │─────────────────────>│ MCP Server        │
│  session-    │  "load memories"     │ (engram)│
│  start.sh    │<─────────────────────│                   │
│              │  systemMessage with  │  ┌─────────────┐  │
└──────────────┘  relevant memories   │  │ SurrealDB   │  │
                                      │  │ Client      │  │
┌──────────────┐     PostToolUse      │  │             │  │
│  Hook:       │─────────────────────>│  │ tools.js    │  │
│  post-tool   │  "store outcome"     │  │ resources.js│  │
│  .sh         │                      │  └──────┬──────┘  │
└──────────────┘                      │         │         │
                                      │    ┌────▼────┐    │
┌──────────────┐     PreCompact       │    │SurrealDB│    │
│  Hook:       │─────────────────────>│    │ (embed/ │    │
│  pre-compact │  "save context"      │    │ local/  │    │
│  .sh         │                      │    │ cloud)  │    │
└──────────────┘                      │    └─────────┘    │
                                      └──────────────────┘
┌──────────────┐     SessionEnd              ▲
│  Hook:       │─────────────────────────────┘
│  session-end │  "persist learnings"
│  .sh         │
└──────────────┘

┌──────────────┐                     ┌──────────────────┐
│  Commands:   │                     │  Agents:         │
│  /remember   │────── MCP tools ──>│  consolidator    │
│  /recall     │<───── MCP tools ───│  reviewer        │
│  /forget     │                     └──────────────────┘
│  /memory-    │
│   status     │     ┌──────────────────┐
│  /memory-    │     │  Skills:         │
│   setup      │     │  memory-query    │── loaded on trigger
└──────────────┘     │  memory-admin    │
                     │  memory-setup    │
                     └──────────────────┘

┌────────────────────────────────┐
│  .claude/engram      │
│  .local.md                     │── read by all hooks + commands
│  (user configuration)          │
└────────────────────────────────┘
```

---

## Cross-References

- [[Hierarchical Memory Model]] — The user/project/session memory hierarchy
- [[MCP Server Design]] — Full MCP tool and resource specifications
- [[Self-Evolving Memory Mechanism]] — Promotion, consolidation, and decay algorithms
- [[Multi-Deployment Architecture]] — Embedded, local, and cloud deployment details
- [[Hooks System Design]] — Detailed hook behavior and data flow
- [[Implementation Blueprint]] — Step-by-step build plan and file index
