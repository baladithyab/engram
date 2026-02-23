# Hooks System for Automatic Memory

This document defines the complete hooks system that enables Claude Code to automatically
query, inject, and persist memories from SurrealDB without requiring explicit user commands.
Every hook event type is covered, with exact `hooks.json` configuration, SurrealDB queries,
and performance analysis.

Related docs: [[Plugin Structure and Architecture]], [[Hierarchical Memory Model]],
[[MCP Server for Memory Operations]], [[Self-Evolving Memory]]

---

## Design Principles

1. **Invisible by default** — The user never types "remember this" or "recall that." Hooks
   fire automatically at the right lifecycle moments.
2. **Never block the user** — Every hook has a timeout. Failures are swallowed silently
   (logged, not surfaced). Claude continues normally if memory is unavailable.
3. **Token budget discipline** — Injected context respects a configurable ceiling (default
   2000 tokens) to avoid crowding out the user's actual work.
4. **Read-heavy, write-light** — Reads happen on the hot path (SessionStart,
   UserPromptSubmit). Writes happen on the cool path (PostToolUse, Stop, PreCompact)
   where latency matters less.
5. **Idempotent writes** — Storing the same memory twice produces no duplicates. SurrealDB
   `UPSERT` or content-hash dedup handles this.

---

## Hook Execution Model

Claude Code runs all matching hooks **in parallel** within each event. Hooks within the
same matcher array run concurrently, not sequentially. This means:

- Hooks cannot depend on each other's output within the same event
- The fastest hook's output appears first; others append
- A slow hook does not delay a fast hook (up to the timeout)

For memory, this is ideal: we can run a SurrealDB query and a local cache check in
parallel, returning whichever resolves first.

---

## Complete hooks.json

The full plugin hook configuration. Each section is explained in detail below.

```json
{
  "description": "SurrealDB Memory Plugin — automatic memory hooks for Claude Code",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "You have access to the memory MCP server. The user just submitted a prompt. Silently determine if any memories would help answer this prompt. If the prompt references past work, decisions, patterns, errors, or conventions, query memory using the appropriate MCP tool (memory_search or memory_query). Inject any relevant memories as a brief system note prefixed with '[Memory]'. Keep injected context under 1500 tokens. If nothing relevant is found, return nothing. Do NOT mention the memory system to the user. Do NOT slow down the response — if the query takes too long, skip it.",
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Before reading this file, silently check memory for any notes about it. Use the memory MCP tool memory_search with the file path as query. If there are memories about this file (known issues, conventions, recent changes, ownership), inject them as a brief '[Memory]' note. Keep under 500 tokens. If nothing found, return nothing. Do NOT mention the memory system to the user.",
            "timeout": 3
          }
        ]
      },
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Before writing/editing this file, silently check memory for coding conventions, patterns, or known constraints for this file or its directory. Use memory_search with the file path. If there are relevant conventions (formatting, naming, architecture patterns, gotchas), inject them as a brief '[Memory]' note so you follow established patterns. Keep under 500 tokens. If nothing found, return nothing. Do NOT mention the memory system.",
            "timeout": 3
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Before running this command, silently check memory for past outcomes of similar commands in this project. Use memory_search with the command string. If there are memories of failures, required flags, environment prerequisites, or known issues with this command, inject them as a brief '[Memory]' warning. Keep under 300 tokens. If nothing found, return nothing. Do NOT mention the memory system.",
            "timeout": 3
          }
        ]
      },
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "A subagent is about to be launched. Silently query memory for context relevant to the subagent's task description. Use memory_search with keywords from the task prompt. If there are relevant project memories (architecture decisions, known issues, file locations, conventions), compile them into a brief '[Memory: Subagent Context]' note that will help the subagent work effectively. Keep under 800 tokens. If nothing found, return nothing.",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/post-write.sh",
            "timeout": 5
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/post-bash.sh",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "The session is ending. Before stopping, consolidate what was learned in this session. Use the memory MCP tools to store: (1) A session summary — what was the goal, what was accomplished, key decisions made (memory_store with scope='session'). (2) Any new project-level knowledge discovered — architecture patterns, file purposes, conventions, gotchas (memory_store with scope='project'). (3) Any unresolved issues or next steps (memory_store with scope='project', tagged as 'todo'). (4) If any errors were encountered and resolved, store the problem-solution pair (memory_store with scope='project', tagged as 'debugging'). Keep each memory concise (under 200 tokens). Promote important session memories to project scope. Do NOT ask the user for confirmation — just store silently. Return 'approve' when done.",
            "timeout": 30
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "A subagent has finished its work. Review what the subagent discovered or accomplished. If it produced significant findings — new code patterns, resolved issues, architectural insights, or important file discoveries — store them using memory_store with scope='session' and tag='subagent-discovery'. Include the subagent's task description for attribution. Keep each memory under 150 tokens. Do NOT mention memory to the user.",
            "timeout": 10
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
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/pre-compact.sh",
            "timeout": 15
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/notification.sh",
            "timeout": 5
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
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/session-end.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

---

## Hook-by-Hook Design

### 1. SessionStart — Load Memory Context

**Event:** `SessionStart`
**Type:** Command hook (bash script)
**Timeout:** 10 seconds
**Purpose:** Query SurrealDB for relevant memories and inject them as initial context.

#### Why command, not prompt?

SessionStart fires before the LLM is available for prompt-based hooks in the normal
conversation flow. A command hook can query SurrealDB directly via HTTP API and write
context into the environment. It also lets us set `$CLAUDE_ENV_FILE` variables for use
throughout the session.

#### Script: `hooks/session-start.sh`

```bash
#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"
source "$PLUGIN_ROOT/lib/config.sh"
source "$PLUGIN_ROOT/lib/surrealdb.sh"

# Read hook input from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$CWD}"

# Extract project identifier from directory path
PROJECT_KEY=$(echo "$PROJECT_DIR" | md5sum | cut -c1-12)

# Token budget from config (default 2000)
TOKEN_BUDGET=$(get_config "hooks.session_start.token_budget" "2000")

# Query 1: Project-level memories (architecture, conventions, known issues)
PROJECT_MEMORIES=$(surreal_query "
  SELECT content, tags, importance, updated_at
  FROM memory
  WHERE scope = 'project'
    AND project = '$PROJECT_KEY'
    AND importance >= 0.5
  ORDER BY importance DESC, updated_at DESC
  LIMIT 20
" 2>/dev/null || echo "[]")

# Query 2: Recent session summaries for this project (last 5 sessions)
SESSION_SUMMARIES=$(surreal_query "
  SELECT content, created_at
  FROM memory
  WHERE scope = 'session'
    AND project = '$PROJECT_KEY'
    AND 'session-summary' IN tags
  ORDER BY created_at DESC
  LIMIT 5
" 2>/dev/null || echo "[]")

# Query 3: User-level preferences and patterns
USER_MEMORIES=$(surreal_query "
  SELECT content, tags
  FROM memory
  WHERE scope = 'user'
    AND importance >= 0.7
  ORDER BY importance DESC
  LIMIT 10
" 2>/dev/null || echo "[]")

# Query 4: Unresolved issues / TODOs for this project
OPEN_ISSUES=$(surreal_query "
  SELECT content, created_at
  FROM memory
  WHERE scope = 'project'
    AND project = '$PROJECT_KEY'
    AND 'todo' IN tags
    AND resolved = false
  ORDER BY created_at DESC
  LIMIT 5
" 2>/dev/null || echo "[]")

# Assemble context, respecting token budget
CONTEXT=$("$PLUGIN_ROOT/lib/assemble-context.sh" \
  --budget "$TOKEN_BUDGET" \
  --project-memories "$PROJECT_MEMORIES" \
  --session-summaries "$SESSION_SUMMARIES" \
  --user-memories "$USER_MEMORIES" \
  --open-issues "$OPEN_ISSUES"
)

# If we have context to inject, output it as a system message
if [ -n "$CONTEXT" ] && [ "$CONTEXT" != "null" ]; then
  jq -n --arg msg "$CONTEXT" '{
    "continue": true,
    "suppressOutput": false,
    "systemMessage": $msg
  }'
else
  echo '{"continue": true, "suppressOutput": true}'
fi

# Persist session metadata in env for other hooks to use
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export MEMORY_SESSION_ID=\"$SESSION_ID\"" >> "$CLAUDE_ENV_FILE"
  echo "export MEMORY_PROJECT_KEY=\"$PROJECT_KEY\"" >> "$CLAUDE_ENV_FILE"
  echo "export MEMORY_PROJECT_DIR=\"$PROJECT_DIR\"" >> "$CLAUDE_ENV_FILE"
fi
```

#### What it queries from SurrealDB

| Query | Table | Scope | Filters | Limit |
|-------|-------|-------|---------|-------|
| Project architecture & conventions | `memory` | `project` | importance >= 0.5 | 20 |
| Recent session summaries | `memory` | `session` | tag = 'session-summary' | 5 |
| User preferences | `memory` | `user` | importance >= 0.7 | 10 |
| Open issues / TODOs | `memory` | `project` | tag = 'todo', resolved = false | 5 |

#### Performance Impact

- **Latency:** 4 parallel SurrealDB queries via HTTP. SurrealDB in-memory mode responds
  in < 10ms per query. Total: ~50ms including network overhead to localhost.
- **Token cost:** Up to 2000 tokens injected into context. Configurable.
- **Failure mode:** If SurrealDB is unreachable, queries return `[]`, context is empty,
  session starts normally. No user-visible error.

---

### 2. UserPromptSubmit — Contextual Memory Recall

**Event:** `UserPromptSubmit`
**Type:** Prompt-based hook
**Timeout:** 5 seconds
**Purpose:** Analyze the user's prompt and inject relevant memories as additional context.

#### Why prompt-based?

The hook needs to understand the user's intent to determine what memories are relevant.
A bash script cannot reason about "the user is asking about authentication — let me
recall that we decided to use JWT tokens in session #42." Only an LLM can bridge natural
language queries to memory search terms.

#### How it works

1. The prompt hook receives `$USER_PROMPT` as input
2. The LLM analyzes the prompt for memory-relevant keywords and intent
3. It calls the memory MCP tool `memory_search` with extracted search terms
4. If relevant memories are found, it injects them as a `[Memory]` prefixed system note
5. If nothing relevant, it returns nothing (no injected context)

#### SurrealDB interaction

The hook uses the MCP server's `memory_search` tool, which internally runs:

```sql
SELECT content, scope, tags, importance, similarity
FROM memory
WHERE project = $project_key
  AND (scope = 'project' OR scope = 'session')
  AND content @@ $search_terms
ORDER BY similarity DESC, importance DESC
LIMIT 5
```

Where `@@` is SurrealDB's full-text search operator, and `$search_terms` are extracted
by the LLM from the user's prompt.

#### Performance Impact

- **Latency:** This is the most latency-sensitive hook. The 5-second timeout is a hard
  ceiling. In practice, the LLM prompt evaluation + one MCP tool call should complete
  in 1-3 seconds.
- **Optimization strategies:**
  - The prompt instructs the LLM to skip the query entirely if the user's prompt is
    clearly self-contained (e.g., "What time is it?")
  - MCP tool calls within prompt hooks are fast because they go through the already-
    connected MCP server socket
  - SurrealDB full-text search on an in-memory dataset is sub-millisecond
- **Token cost:** Up to 1500 tokens injected per prompt. In practice, most prompts
  inject 0-500 tokens.
- **Failure mode:** Timeout or MCP error results in no injected context. The LLM
  proceeds with the user's prompt as normal.

#### Critical constraint

This hook fires on EVERY user prompt. It must be disciplined about when to query:

- Short, simple prompts ("yes", "continue", "looks good") should skip memory entirely
- Prompts that clearly reference past context ("like we did before", "that bug we fixed")
  should always query
- New task prompts should query for project conventions and related past work

---

### 3. PreToolUse — Memory-Augmented Tool Calls

Four separate matchers cover the major tool categories.

#### 3a. Before Read — File Knowledge Recall

**Matcher:** `Read`
**Type:** Prompt-based
**Timeout:** 3 seconds

The LLM queries memory for notes about the specific file being read. This helps when:
- The file has known issues or gotchas
- The file was recently modified and there's context about why
- The file has specific ownership or conventions

**SurrealDB query** (via MCP `memory_search`):
```sql
SELECT content, tags FROM memory
WHERE project = $project_key
  AND 'file-note' IN tags
  AND metadata.file_path = $file_path
ORDER BY updated_at DESC
LIMIT 3
```

**Performance:** 3-second timeout. In practice, < 1 second. The file path is an exact
match query, not full-text search, so SurrealDB returns in microseconds.

#### 3b. Before Write/Edit — Convention Enforcement

**Matcher:** `Write|Edit`
**Type:** Prompt-based
**Timeout:** 3 seconds

Queries memory for coding conventions, patterns, and known constraints for the target
file or directory. This ensures Claude follows established patterns even across sessions.

**SurrealDB query** (via MCP `memory_search`):
```sql
SELECT content, tags FROM memory
WHERE project = $project_key
  AND ('convention' IN tags OR 'pattern' IN tags)
  AND (
    metadata.file_path = $file_path
    OR metadata.directory = $parent_directory
    OR metadata.file_type = $extension
  )
ORDER BY importance DESC
LIMIT 5
```

**Performance:** 3-second timeout. Sub-second in practice.

#### 3c. Before Bash — Command History Recall

**Matcher:** `Bash`
**Type:** Prompt-based
**Timeout:** 3 seconds

Checks memory for past outcomes of similar commands. Prevents re-encountering known
failures and ensures required flags or prerequisites are met.

**SurrealDB query** (via MCP `memory_search`):
```sql
SELECT content, tags, metadata FROM memory
WHERE project = $project_key
  AND ('command-outcome' IN tags OR 'debugging' IN tags)
  AND content @@ $command_keywords
ORDER BY updated_at DESC
LIMIT 3
```

**Performance:** 3-second timeout. Full-text search, still sub-second on in-memory data.

#### 3d. Before Task (Subagent) — Context Briefing

**Matcher:** `Task`
**Type:** Prompt-based
**Timeout:** 5 seconds

Compiles relevant project knowledge for a subagent that does not share the parent's
conversation history. This is one of the highest-value hooks — subagents often duplicate
work or miss context that the parent already discovered.

**SurrealDB query** (via MCP `memory_search`):
```sql
SELECT content, scope, tags FROM memory
WHERE project = $project_key
  AND scope IN ['project', 'session']
  AND content @@ $task_keywords
ORDER BY importance DESC, updated_at DESC
LIMIT 10
```

**Performance:** 5-second timeout. Slightly more generous because subagent launch itself
is not instantaneous, so the user perceives less added latency.

---

### 4. PostToolUse — Memory Persistence

These are command hooks (bash scripts) because they perform fire-and-forget writes.
They do not need LLM reasoning — the data to store is deterministic (the tool input
and output are available in stdin).

#### 4a. After Write/Edit — Store Change Context

**Matcher:** `Write|Edit`
**Type:** Command hook
**Timeout:** 5 seconds

#### Script: `hooks/post-write.sh`

```bash
#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"
source "$PLUGIN_ROOT/lib/surrealdb.sh"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
# For Edit, capture what changed
OLD_STRING=$(echo "$INPUT" | jq -r '.tool_input.old_string // ""' | head -c 200)
NEW_STRING=$(echo "$INPUT" | jq -r '.tool_input.new_string // ""' | head -c 200)

PROJECT_KEY="${MEMORY_PROJECT_KEY:-unknown}"
SESSION_ID="${MEMORY_SESSION_ID:-unknown}"

# Build a concise change description
if [ "$TOOL_NAME" = "Edit" ]; then
  CHANGE_DESC="Edited $FILE_PATH: replaced '${OLD_STRING:0:80}...' with '${NEW_STRING:0:80}...'"
elif [ "$TOOL_NAME" = "Write" ]; then
  CHANGE_DESC="Wrote file $FILE_PATH"
fi

# Store as session-scoped memory (may be promoted to project scope by Stop hook)
surreal_query "
  CREATE memory SET
    scope = 'session',
    project = '$PROJECT_KEY',
    session_id = '$SESSION_ID',
    content = $(jq -n --arg c "$CHANGE_DESC" '$c'),
    tags = ['file-change', 'auto-captured'],
    metadata = {
      file_path: '$FILE_PATH',
      tool: '$TOOL_NAME',
      directory: '$(dirname "$FILE_PATH")',
      file_type: '${FILE_PATH##*.}'
    },
    importance = 0.3,
    resolved = true,
    created_at = time::now(),
    updated_at = time::now()
" >/dev/null 2>&1 || true

# Output nothing — PostToolUse command hooks output is shown in transcript
# We want this to be silent
echo '{"continue": true, "suppressOutput": true}'
```

#### 4b. After Bash — Store Command Outcomes (Especially Errors)

**Matcher:** `Bash`
**Type:** Command hook
**Timeout:** 5 seconds

#### Script: `hooks/post-bash.sh`

```bash
#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"
source "$PLUGIN_ROOT/lib/surrealdb.sh"

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' | head -c 300)
EXIT_CODE=$(echo "$INPUT" | jq -r '.tool_result.exit_code // 0')
STDERR=$(echo "$INPUT" | jq -r '.tool_result.stderr // ""' | head -c 500)

PROJECT_KEY="${MEMORY_PROJECT_KEY:-unknown}"
SESSION_ID="${MEMORY_SESSION_ID:-unknown}"

# Only store failures or significant commands — skip trivial successes
# to avoid flooding memory with `ls`, `cd`, etc.
if [ "$EXIT_CODE" != "0" ]; then
  IMPORTANCE=0.6
  TAGS='["command-outcome", "error", "debugging", "auto-captured"]'
  CONTENT="Command failed (exit $EXIT_CODE): $COMMAND | Error: $STDERR"
elif echo "$COMMAND" | grep -qE '(install|build|deploy|migrate|test|docker|terraform|cdk)'; then
  IMPORTANCE=0.4
  TAGS='["command-outcome", "auto-captured"]'
  CONTENT="Command succeeded: $COMMAND"
else
  # Trivial command, don't store
  echo '{"continue": true, "suppressOutput": true}'
  exit 0
fi

surreal_query "
  CREATE memory SET
    scope = 'session',
    project = '$PROJECT_KEY',
    session_id = '$SESSION_ID',
    content = $(jq -n --arg c "$CONTENT" '$c'),
    tags = $TAGS,
    metadata = {
      command: $(jq -n --arg c "$COMMAND" '$c'),
      exit_code: $EXIT_CODE
    },
    importance = $IMPORTANCE,
    resolved = true,
    created_at = time::now(),
    updated_at = time::now()
" >/dev/null 2>&1 || true

echo '{"continue": true, "suppressOutput": true}'
```

#### Performance Impact (PostToolUse hooks)

- **Latency:** These fire AFTER the tool completes, so they do not add latency to the
  user-perceived tool execution time. The 5-second timeout is generous.
- **Write volume:** The Bash hook filters out trivial commands. The Write/Edit hook fires
  once per file operation. In a typical session, this produces 5-30 memory entries.
- **Failure mode:** `|| true` ensures SurrealDB write failures are silent. The user
  never sees memory storage errors.

---

### 5. Stop — Session Consolidation

**Event:** `Stop`
**Type:** Prompt-based hook
**Timeout:** 30 seconds
**Purpose:** Before the agent stops, consolidate everything learned into durable memory.

This is the most important write hook. It fires once per session and has the richest
context available (the full conversation is still in the LLM's context window).

#### What it stores

| Memory Type | Scope | Tags | Example |
|-------------|-------|------|---------|
| Session summary | session | `session-summary` | "Implemented JWT auth for the API. Used RS256 with rotating keys. Tests pass." |
| Architecture decisions | project | `decision`, `architecture` | "Decided to use event sourcing for order processing. See src/events/." |
| Discovered patterns | project | `convention`, `pattern` | "All API handlers in this project use the middleware chain pattern in src/middleware/." |
| Resolved issues | project | `debugging`, `resolved` | "CORS errors were caused by missing preflight handler. Fixed in api-gateway.ts." |
| Unresolved issues | project | `todo`, `unresolved` | "The batch endpoint times out for > 1000 items. Needs pagination." |
| Scope promotion | project | (original tags) | Session memories with importance > 0.7 promoted to project scope |

#### Performance Impact

- **Latency:** 30-second timeout. This is acceptable because it fires when the user has
  already finished their task. The agent may take 5-15 seconds to consolidate, which the
  user may not even notice.
- **Token cost:** The LLM processes the full conversation context to extract memories.
  This uses the same token budget as any other agent response — no additional cost.
- **Write volume:** Typically 3-8 memory entries per session.

---

### 6. SubagentStop — Capture Subagent Discoveries

**Event:** `SubagentStop`
**Type:** Prompt-based hook
**Timeout:** 10 seconds
**Purpose:** When a subagent finishes, extract and store its discoveries before they
are lost (subagent context is not merged back into the parent's conversation).

#### Why this matters

Subagents (Task tool, Explore agents) often discover important information that the
parent agent only sees as a brief summary. The full context of what the subagent found
is discarded after the subagent stops. This hook captures it.

#### What it stores

| Memory Type | Scope | Tags |
|-------------|-------|------|
| Subagent findings | session | `subagent-discovery`, `auto-captured` |
| File discoveries | session | `subagent-discovery`, `file-note` |
| Error resolutions | session | `subagent-discovery`, `debugging` |

#### Performance Impact

- **Latency:** 10-second timeout. Fires after subagent completes, so no perceived delay
  in the parent's workflow.
- **Token cost:** Minimal. The subagent's output is already in context.
- **Write volume:** 1-3 entries per subagent.

---

### 7. PreCompact — Context Preservation

**Event:** `PreCompact`
**Type:** Command hook (bash script)
**Timeout:** 15 seconds
**Purpose:** Before conversation compaction discards context, save critical information
to SurrealDB so it can be recalled later.

This is a safety net. Compaction happens automatically when the conversation exceeds
the context window. Without this hook, everything not in the compacted summary is lost
forever.

#### Script: `hooks/pre-compact.sh`

```bash
#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"
source "$PLUGIN_ROOT/lib/surrealdb.sh"

INPUT=$(cat)
SESSION_ID="${MEMORY_SESSION_ID:-unknown}"
PROJECT_KEY="${MEMORY_PROJECT_KEY:-unknown}"
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // ""')

# If we have access to the transcript, extract key context
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  # Extract the last N lines of the transcript that are about to be compacted
  # Focus on assistant messages with decisions, not tool outputs
  CONTEXT_SNAPSHOT=$(tail -n 200 "$TRANSCRIPT_PATH" | head -c 4000)

  surreal_query "
    CREATE memory SET
      scope = 'session',
      project = '$PROJECT_KEY',
      session_id = '$SESSION_ID',
      content = $(jq -n --arg c "Pre-compaction context snapshot: $CONTEXT_SNAPSHOT" '$c'),
      tags = ['compaction-snapshot', 'auto-captured'],
      metadata = {
        event: 'pre-compact',
        transcript_lines: 200
      },
      importance = 0.5,
      resolved = true,
      created_at = time::now(),
      updated_at = time::now()
  " >/dev/null 2>&1 || true
fi

# Also store a marker so we know compaction happened
surreal_query "
  CREATE memory SET
    scope = 'session',
    project = '$PROJECT_KEY',
    session_id = '$SESSION_ID',
    content = 'Context compaction occurred. Some conversation context was lost. Check compaction-snapshot memories for preserved context.',
    tags = ['compaction-event', 'auto-captured'],
    metadata = { event: 'pre-compact' },
    importance = 0.4,
    resolved = true,
    created_at = time::now(),
    updated_at = time::now()
" >/dev/null 2>&1 || true

echo '{"continue": true, "suppressOutput": true}'
```

#### Performance Impact

- **Latency:** 15-second timeout. Compaction is already a noticeable pause for the user,
  so a few extra seconds is acceptable.
- **Write volume:** 1-2 entries per compaction event. Compaction typically happens 0-2
  times per session.
- **Risk:** The transcript file may be large. The script limits extraction to 200 lines /
  4000 characters to avoid overloading the SurrealDB write.

---

### 8. Notification — Activity Logging

**Event:** `Notification`
**Type:** Command hook (bash script)
**Timeout:** 5 seconds
**Purpose:** Log notification events for session activity tracking.

#### Script: `hooks/notification.sh`

```bash
#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"
source "$PLUGIN_ROOT/lib/surrealdb.sh"

INPUT=$(cat)
SESSION_ID="${MEMORY_SESSION_ID:-unknown}"
PROJECT_KEY="${MEMORY_PROJECT_KEY:-unknown}"

# Lightweight: just log that a notification happened for session activity tracking
# This helps reconstruct session timelines when reviewing past work
surreal_query "
  UPDATE session_activity SET
    last_notification = time::now(),
    notification_count += 1
  WHERE session_id = '$SESSION_ID'
" >/dev/null 2>&1 || true

echo '{"continue": true, "suppressOutput": true}'
```

#### Performance Impact

- **Latency:** Negligible. Single atomic update.
- **Purpose:** Primarily for the [[Self-Evolving Memory]] system to understand session
  activity patterns. Not high-value on its own.

---

### 9. SessionEnd — Final Cleanup

**Event:** `SessionEnd`
**Type:** Command hook (bash script)
**Timeout:** 10 seconds
**Purpose:** Final session bookkeeping after the Stop hook has already stored memories.

#### Script: `hooks/session-end.sh`

```bash
#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"
source "$PLUGIN_ROOT/lib/surrealdb.sh"

SESSION_ID="${MEMORY_SESSION_ID:-unknown}"
PROJECT_KEY="${MEMORY_PROJECT_KEY:-unknown}"

# Mark the session as ended in SurrealDB
surreal_query "
  UPSERT session_meta:[$SESSION_ID] SET
    session_id = '$SESSION_ID',
    project = '$PROJECT_KEY',
    ended_at = time::now(),
    status = 'completed'
" >/dev/null 2>&1 || true

# Flush the local cache (if using a file-based cache layer)
CACHE_DIR="/tmp/claude-memory-cache/$SESSION_ID"
if [ -d "$CACHE_DIR" ]; then
  rm -rf "$CACHE_DIR"
fi

echo '{"continue": true, "suppressOutput": true}'
```

---

## Performance Strategy

### Latency Budget by Hook

| Hook | Event Path | Timeout | Expected Latency | User Impact |
|------|-----------|---------|-------------------|-------------|
| SessionStart | Cold path | 10s | 50-200ms | Once per session, not noticeable |
| UserPromptSubmit | **Hot path** | 5s | 1-3s | **Most sensitive** — added to every prompt |
| PreToolUse (Read) | Warm path | 3s | 200-800ms | Adds to file read, low impact |
| PreToolUse (Write/Edit) | Warm path | 3s | 200-800ms | Adds to file write, low impact |
| PreToolUse (Bash) | Warm path | 3s | 200-800ms | Adds to command execution, low impact |
| PreToolUse (Task) | Cold path | 5s | 1-2s | Subagent launch is already slow |
| PostToolUse (Write) | Cool path | 5s | 50-100ms | After tool, no user wait |
| PostToolUse (Bash) | Cool path | 5s | 50-100ms | After tool, no user wait |
| Stop | Cold path | 30s | 5-15s | Session is ending, user is done |
| SubagentStop | Cold path | 10s | 2-5s | Between subagent and parent |
| PreCompact | Cold path | 15s | 200-500ms | Compaction pause absorbs it |
| Notification | Cool path | 5s | 10-50ms | Background, invisible |
| SessionEnd | Cold path | 10s | 50-100ms | Session is over |

### Caching Layer

To minimize SurrealDB round-trips on the hot path, implement a file-based cache:

```
/tmp/claude-memory-cache/{session_id}/
  project-memories.json     # Cached at SessionStart, refreshed every 5 min
  recent-queries.json       # LRU cache of memory_search results
  file-notes/               # Per-file memory cache (keyed by file path hash)
```

The `session-start.sh` script populates the cache. Subsequent hooks check the cache
first and only hit SurrealDB on cache miss. The `session-end.sh` script cleans up.

**Cache invalidation:** Writes to memory (PostToolUse, Stop) should invalidate relevant
cache entries. Since writes happen on the cool path and reads on the hot path, this
keeps reads fast.

### Async vs. Blocking

Claude Code hooks are inherently blocking — the event waits for all hooks to complete
(up to timeout) before proceeding. However, there are strategies to minimize blocking:

| Strategy | Hooks | Mechanism |
|----------|-------|-----------|
| Early exit | UserPromptSubmit, PreToolUse | If the prompt/tool is clearly irrelevant to memory, exit immediately without querying |
| Cache-first | PreToolUse (Read, Write) | Check file-based cache before querying SurrealDB |
| Fire-and-forget writes | PostToolUse | Write to SurrealDB and exit immediately; don't wait for confirmation |
| Aggressive timeouts | All hooks | Short timeouts ensure a slow query never blocks the user |

### Token Budget Management

Injected memory context competes with the user's actual work for context window space.
The budget system ensures memory never crowds out real content.

| Hook | Token Budget | Rationale |
|------|-------------|-----------|
| SessionStart | 2000 tokens | One-time load, comprehensive overview |
| UserPromptSubmit | 1500 tokens | Per-prompt, must leave room for response |
| PreToolUse (Read) | 500 tokens | Brief file notes |
| PreToolUse (Write/Edit) | 500 tokens | Brief convention reminders |
| PreToolUse (Bash) | 300 tokens | Brief command warnings |
| PreToolUse (Task) | 800 tokens | Subagent needs more context |

**Total worst case per turn:** 2000 (session) + 1500 (prompt) + 500-800 (tool) = ~4300
tokens of memory context. In practice, most turns inject 0-1000 tokens because hooks
skip when nothing relevant is found.

Budgets are configurable via the plugin's `config.json`:

```json
{
  "hooks": {
    "session_start": { "token_budget": 2000 },
    "user_prompt": { "token_budget": 1500 },
    "pre_read": { "token_budget": 500 },
    "pre_write": { "token_budget": 500 },
    "pre_bash": { "token_budget": 300 },
    "pre_task": { "token_budget": 800 }
  }
}
```

---

## Error Handling Strategy

Hooks must NEVER block Claude. Every hook follows this error contract:

### Command hooks

```bash
# Pattern: every SurrealDB call has `|| true`
surreal_query "..." >/dev/null 2>&1 || true

# Pattern: always output valid JSON, even on error
trap 'echo "{\"continue\": true, \"suppressOutput\": true}"' EXIT
```

### Prompt hooks

The prompt text explicitly instructs the LLM:
- "If the query takes too long, skip it"
- "If nothing found, return nothing"
- "Do NOT mention the memory system to the user"

### Timeout behavior

When a hook times out, Claude Code kills it and proceeds as if the hook returned
`{"continue": true}`. This is the default behavior — no special handling needed.

### SurrealDB unavailable

If SurrealDB is down or unreachable:
- SessionStart: injects no context, session starts normally
- UserPromptSubmit: injects no context, prompt proceeds normally
- PreToolUse: injects no context, tool executes normally
- PostToolUse: writes silently fail, no data loss (the data was ephemeral)
- Stop: LLM attempts to store but MCP calls fail; no session summary is persisted
- PreCompact: writes fail, compaction proceeds normally

The only data loss risk is in the Stop hook — if SurrealDB is down when a session ends,
that session's summary is lost. Mitigation: the Stop hook could fall back to writing a
local JSON file that is synced to SurrealDB when it comes back online.

---

## Shared Library Scripts

### `lib/surrealdb.sh` — SurrealDB HTTP Client

```bash
#!/bin/bash
# Shared SurrealDB query function for all hooks

SURREAL_URL="${SURREAL_URL:-http://127.0.0.1:8000}"
SURREAL_NS="${SURREAL_NS:-claude_memory}"
SURREAL_DB="${SURREAL_DB:-memories}"
SURREAL_USER="${SURREAL_USER:-root}"
SURREAL_PASS="${SURREAL_PASS:-root}"

surreal_query() {
  local query="$1"
  curl -s --max-time 3 \
    -X POST "$SURREAL_URL/sql" \
    -H "Accept: application/json" \
    -H "NS: $SURREAL_NS" \
    -H "DB: $SURREAL_DB" \
    -u "$SURREAL_USER:$SURREAL_PASS" \
    -d "$query" 2>/dev/null \
    | jq -r '.[0].result // "[]"' 2>/dev/null
}
```

### `lib/config.sh` — Configuration Reader

```bash
#!/bin/bash
# Read plugin configuration values

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"
CONFIG_FILE="$PLUGIN_ROOT/config.json"

get_config() {
  local key="$1"
  local default="$2"
  if [ -f "$CONFIG_FILE" ]; then
    local value
    value=$(jq -r ".$key // \"$default\"" "$CONFIG_FILE" 2>/dev/null)
    echo "${value:-$default}"
  else
    echo "$default"
  fi
}
```

### `lib/assemble-context.sh` — Token-Budgeted Context Assembly

This script takes multiple memory sources and assembles them into a single context
string that fits within the token budget. It prioritizes by:

1. Open issues (most actionable)
2. Project conventions (most reusable)
3. Recent session summaries (most relevant)
4. User preferences (least likely to change)

Each section gets a proportional share of the budget, with overflow going to higher-
priority sections.

---

## Hook Interaction Diagram

```
Session Start
     |
     v
[SessionStart hook] ---> Query SurrealDB ---> Inject project context
     |                                         Set env vars
     v
User types prompt
     |
     v
[UserPromptSubmit hook] ---> Analyze prompt ---> Query memories ---> Inject context
     |
     v
Claude processes prompt, decides to use tools
     |
     +---> [PreToolUse hook] ---> Query memories ---> Inject file/command context
     |            |
     |            v
     |      Tool executes
     |            |
     |            v
     |     [PostToolUse hook] ---> Store outcomes (fire-and-forget)
     |
     +---> (repeat for each tool)
     |
     v
Claude decides to stop
     |
     v
[Stop hook] ---> Consolidate session ---> Store summaries, decisions, patterns
     |
     v
[SessionEnd hook] ---> Mark session ended ---> Clean up cache
     |
     v
Session ends

--- Parallel track (if compaction occurs) ---

Context window fills up
     |
     v
[PreCompact hook] ---> Save context snapshot ---> Compaction proceeds

--- Parallel track (subagents) ---

Parent spawns subagent
     |
     v
[PreToolUse:Task hook] ---> Brief subagent with project context
     |
     v
Subagent works...
     |
     v
[SubagentStop hook] ---> Capture subagent discoveries
```

---

## File Layout in Plugin

```
hooks/
  hooks.json                # The complete configuration above
  session-start.sh          # SessionStart: load memories
  post-write.sh             # PostToolUse(Write|Edit): store changes
  post-bash.sh              # PostToolUse(Bash): store command outcomes
  pre-compact.sh            # PreCompact: save context before compaction
  notification.sh           # Notification: activity tracking
  session-end.sh            # SessionEnd: cleanup
lib/
  surrealdb.sh              # Shared SurrealDB HTTP client
  config.sh                 # Configuration reader
  assemble-context.sh       # Token-budgeted context assembly
config.json                 # Plugin configuration (token budgets, etc.)
```

---

## Open Questions

1. **Memory deduplication** — PostToolUse hooks may store redundant memories across
   sessions (e.g., the same file gets edited with the same convention note). The
   [[Self-Evolving Memory]] system should handle dedup and consolidation.

2. **Prompt hook tool access** — The design assumes prompt-based hooks can call MCP
   tools (like `memory_search`). This needs verification with the Claude Code hooks
   runtime. If not, prompt hooks would need to be converted to command hooks that
   call the MCP server's HTTP API directly.

3. **Transcript access in PreCompact** — The `transcript_path` field in hook input
   needs verification. If the transcript is not available as a file path, the
   PreCompact hook would need an alternative approach (e.g., the LLM summarizing
   context in a prompt-based hook instead).

4. **Hook ordering guarantees** — The docs state hooks run in parallel, but Stop must
   run before SessionEnd for the session summary to be written first. Need to verify
   if event ordering (Stop fires before SessionEnd) is guaranteed.

5. **Cost of UserPromptSubmit** — This is the most expensive hook (prompt-based, fires
   on every prompt). If it adds noticeable latency, consider making it opt-in or
   adding a "fast mode" that skips memory recall for simple prompts.
