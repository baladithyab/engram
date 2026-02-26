# Developer Guide

How to contribute to the engram plugin. Covers project structure,
adding new components, modifying the schema, and testing.

## Project Structure

```
engram/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest (name, version, entry points)
├── .mcp.json                    # MCP server config (command, args, env vars)
├── CLAUDE.md                    # Project instructions for Claude Code
├── commands/                    # Slash commands (auto-discovered)
│   ├── remember.md              # /remember -- store a memory
│   ├── recall.md                # /recall -- search memories
│   ├── forget.md                # /forget -- soft-delete a memory
│   └── memory-status.md         # /memory-status -- show system status
├── agents/                      # Agent definitions (auto-discovered)
│   └── memory-consolidator.md   # Background memory maintenance agent
├── skills/                      # Skills (auto-discovered from SKILL.md)
│   ├── memory-query/
│   │   └── SKILL.md             # How to query and use memories
│   ├── memory-admin/            # Memory lifecycle management (planned)
│   └── memory-setup/            # Deployment configuration (planned)
├── hooks/                       # Lifecycle hooks
│   ├── hooks.json               # Hook definitions (events, commands, timeouts)
│   └── scripts/
│       ├── session-start.sh     # SessionStart: load relevant memories
│       └── pre-compact.sh       # PreCompact: save context before compaction
├── mcp/                         # MCP server (Bun + TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             # Server entry point, config, startup
│       ├── surrealdb-client.ts  # SurrealDB connection wrapper + schema init
│       ├── tools.ts             # MCP tool definitions (store, recall, forget, etc.)
│       └── resources.ts         # MCP resource definitions (memory://status)
└── docs/
    ├── guides/                  # User and developer documentation
    └── research/                # Architecture research and design docs
```

### Key Files

**`plugin.json`** -- the plugin manifest. Declares the plugin name, version,
and points to hooks and MCP server configs. Commands, agents, and skills are
auto-discovered from their respective directories.

**`.mcp.json`** -- tells Claude Code how to start the MCP server. The `command`
is `bun` and `args` points to `mcp/src/index.ts`. Environment variables set
the deployment mode and connection details.

**`hooks.json`** -- declares three hooks: SessionStart (load memories), Stop
(persist learnings via prompt), and PreCompact (save context). Each hook has
a type (`command` for shell scripts, `prompt` for Claude prompts) and a timeout.

**`mcp/src/index.ts`** -- creates the MCP server, initializes the SurrealDB
client with config from environment variables, registers tools and resources,
and starts the stdio transport.

**`mcp/src/surrealdb-client.ts`** -- wraps the `surrealdb` npm package. Handles
connection (embedded/local/remote), schema initialization, and provides typed
methods for store, recall, forget, promote, and status operations.

**`mcp/src/tools.ts`** -- registers five MCP tools on the server: `store_memory`,
`recall_memories`, `forget_memory`, `get_memory_status`, and `promote_memory`.
Each tool has Zod schema validation and returns the standard MCP content format.

**`mcp/src/resources.ts`** -- registers MCP resources. Currently only
`memory://status` which returns connection and count stats as JSON.

## Development Setup

```bash
cd mcp
bun install
```

### Run the MCP Server

For local development and testing:

```bash
cd mcp && bun run dev
```

This starts the server on stdio. To test interactively with Claude Code:

```bash
claude --plugin-dir /path/to/engram
```

### Type Checking

```bash
cd mcp && bun run typecheck
```

Uses TypeScript strict mode with ESNext target and bundler module resolution.
The `tsconfig.json` includes `bun-types` for Bun-specific APIs.

### Build

```bash
cd mcp && bun run build
```

Builds `src/index.ts` to `dist/` targeting Node.

## Adding a New MCP Tool

MCP tools are the primary interface between Claude and the memory system.

### 1. Add the Client Method

In `mcp/src/surrealdb-client.ts`, add a method to `SurrealDBClient`:

```typescript
async searchByTags(params: {
  tags: string[];
  scope?: string;
  limit?: number;
}): Promise<unknown[]> {
  let surql = `SELECT * FROM memory
    WHERE tags CONTAINSANY $tags
      AND status = 'active'`;

  if (params.scope) {
    surql += ` AND scope = $scope`;
  }
  surql += ` ORDER BY importance DESC LIMIT $limit`;

  const result = await this.db.query(surql, {
    tags: params.tags,
    scope: params.scope ?? null,
    limit: params.limit ?? 10,
  });
  return (result as any[]).flat();
}
```

### 2. Register the Tool

In `mcp/src/tools.ts`, add a new `server.tool()` call inside
`registerMemoryTools()`:

```typescript
server.tool(
  "search_by_tags",
  "Search memories by tag names. Returns memories matching any of the given tags.",
  {
    tags: z.array(z.string()).describe("Tags to search for"),
    scope: z.enum(["session", "project", "user"]).optional().describe("Filter by scope"),
    limit: z.number().optional().describe("Max results, default 10"),
  },
  async ({ tags, scope, limit }) => {
    try {
      const memories = await db.searchByTags({ tags, scope, limit });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(memories, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error searching by tags: ${err}` }],
        isError: true,
      };
    }
  }
);
```

### 3. Verify

Run `bun run typecheck` and test in Claude Code.

### Tool Conventions

- Tool names use `snake_case`
- Descriptions start with an action verb
- All parameters use Zod schemas with `.describe()` for documentation
- Success returns `{ content: [{ type: "text", text: JSON.stringify(...) }] }`
- Errors return `{ content: [{ type: "text", text: "Error: ..." }], isError: true }`
- Methods on `SurrealDBClient` handle the SurrealQL; tools handle validation and formatting

## Adding a Slash Command

Commands live in `commands/` as markdown files with YAML frontmatter.

### 1. Create the Command File

Create `commands/my-command.md`:

```markdown
---
name: my-command
description: One-line description of what this command does.
arguments:
  - name: query
    description: The search query
    required: true
---

Instructions for Claude when this command is invoked.

Explain what MCP tools to call and how to format the output.
```

### 2. Conventions

- File name matches the command name (kebab-case)
- `name` in frontmatter is the slash command trigger (e.g., `/my-command`)
- `arguments` is optional -- omit if the command takes no args
- The markdown body is the prompt that Claude follows when the command runs
- Reference MCP tools by their registered names (e.g., `store_memory`, `recall_memories`)

## Adding a Hook

Hooks fire automatically at lifecycle events. They are either shell scripts
(`command` type) or Claude prompts (`prompt` type).

### 1. Create the Script

For a command-type hook, create a script in `hooks/scripts/`:

```bash
#!/bin/bash
# hooks/scripts/my-hook.sh
set -uo pipefail

# Quick exit conditions
DATA_PATH="${SURREAL_DATA_PATH:-$HOME/.claude/engram/data}"
if [ ! -d "$DATA_PATH" ]; then
  exit 0
fi

# Hook logic here
# Output goes to stdout and is captured by Claude Code

exit 0
```

Make it executable:

```bash
chmod +x hooks/scripts/my-hook.sh
```

### 2. Register in hooks.json

Add an entry to `hooks/hooks.json`:

```json
{
  "type": "PostToolUse",
  "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/my-hook.sh",
  "timeout": 10000
}
```

### Hook Types

| Event | When | Common Use |
|-------|------|-----------|
| `SessionStart` | Conversation begins | Load memories into context |
| `Stop` | Conversation ends | Persist session learnings |
| `PreCompact` | Before context compaction | Save context that would be lost |
| `PostToolUse` | After a tool call | Store tool outcomes |
| `UserPromptSubmit` | User sends a message | Pre-fetch relevant memories |

### Hook Conventions

- Shell scripts use `set -uo pipefail`
- Always `exit 0` on non-critical failures (hooks should never block Claude)
- Use `${CLAUDE_PLUGIN_ROOT}` for paths within the plugin
- Keep timeouts reasonable (10s for lightweight, 30s for heavier operations)
- Prompt-type hooks (like the Stop hook) describe what Claude should do in natural language

## Adding a Skill

Skills provide contextual knowledge that Claude loads when relevant.

### 1. Create the Skill Directory

```bash
mkdir -p skills/my-skill
```

### 2. Create SKILL.md

```markdown
---
name: my-skill
description: |
  This skill should be used when [trigger conditions].
  Triggers on: "keyword1", "keyword2", "keyword3".
---

# Skill Title

## Section 1
Content that helps Claude handle the trigger scenario...

## Section 2
Reference information, patterns, examples...
```

### Skill Conventions

- Skills live in `skills/{skill-name}/SKILL.md`
- The `description` field tells Claude when to load the skill
- Keep SKILL.md lean -- put detailed reference material in a `references/` subdirectory
- Skills are informational (they do not execute code), they guide Claude's behavior

## Adding an Agent

Agents are autonomous Claude instances that handle specific tasks.

### 1. Create the Agent File

Create `agents/my-agent.md`:

```markdown
---
name: my-agent
description: |
  Use this agent when [conditions]. Examples:

  <example>
  Context: [situation]
  user: "[trigger phrase]"
  assistant: "[how Claude invokes the agent]"
  <commentary>
  [Why this agent is appropriate]
  </commentary>
  </example>

model: inherit
color: green
tools: ["Read", "Bash", "Grep"]
---

You are [agent role description].

**Your Responsibilities:**
1. [responsibility]
2. [responsibility]

**Process:**
1. [step]
2. [step]

**Output:** [what the agent reports back]
```

### Agent Conventions

- The `description` includes example triggers so Claude knows when to dispatch
- `model: inherit` uses the same model as the parent session
- `tools` lists which tools the agent can access
- The markdown body is the agent's system prompt
- Agents should produce a structured report summarizing what they did

## Modifying the SurrealDB Schema

The schema is defined in `mcp/src/surrealdb-client.ts` in the `initSchema()`
method. It runs on every server startup, using `DEFINE ... IF NOT EXISTS` to
be idempotent.

### Adding a New Table

```typescript
await this.db.query(`
  DEFINE TABLE IF NOT EXISTS my_table SCHEMAFULL;

  DEFINE FIELD IF NOT EXISTS name ON my_table TYPE string;
  DEFINE FIELD IF NOT EXISTS created_at ON my_table TYPE datetime DEFAULT time::now();

  DEFINE INDEX IF NOT EXISTS my_table_name ON my_table FIELDS name;
`);
```

### Adding a Field to an Existing Table

```typescript
// Add to the existing memory table definition in initSchema()
await this.db.query(`
  DEFINE FIELD IF NOT EXISTS new_field ON memory TYPE option<string>;
`);
```

### Adding an Index

```typescript
await this.db.query(`
  DEFINE INDEX IF NOT EXISTS memory_tags ON memory FIELDS tags;
`);
```

### Schema Conventions

- All tables use `SCHEMAFULL` (explicit field definitions, no arbitrary fields)
- Use `IF NOT EXISTS` on all definitions for idempotent startup
- Field types: `string`, `int`, `float`, `bool`, `datetime`, `array<T>`, `option<T>`, `object`
- Use `FLEXIBLE TYPE` for schema-optional fields (like `metadata`)
- Timestamps use `datetime` type with `DEFAULT time::now()`
- The `ASSERT $value IN [...]` pattern validates enum-like fields

### Current Tables

| Table | Type | Purpose |
|-------|------|---------|
| `memory` | SCHEMAFULL | Main memory storage with BM25 full-text search |
| `entity` | SCHEMAFULL | Knowledge graph nodes (Phase 2) |
| `relates_to` | RELATION | Knowledge graph edges between entities (Phase 2) |

## TypeScript Conventions

- **Strict mode** -- `tsconfig.json` enables `strict: true`
- **ESNext target** -- modern JS features, no downleveling
- **Bundler module resolution** -- for Bun compatibility
- **Bun types** -- `@types/bun` for Bun-specific APIs
- **Zod for validation** -- all MCP tool parameters use Zod schemas
- **Explicit types on public APIs** -- `SurrealDBConfig`, method return types
- **Type assertions for SurrealDB results** -- use `as any[]` then access properties
  (the SurrealDB JS SDK returns loosely typed results)

### Import Style

```typescript
// SDK imports use .js extension (required for ESM)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Type-only imports use the `type` keyword
import type { SurrealDBClient } from "./surrealdb-client.js";
```

### Error Handling Pattern

```typescript
try {
  const result = await db.someOperation(params);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
} catch (err) {
  return {
    content: [{ type: "text" as const, text: `Error doing X: ${err}` }],
    isError: true,
  };
}
```

## Testing Strategy

### Manual Testing

The primary testing approach during MVP:

1. Launch Claude Code with the plugin:
   ```bash
   claude --plugin-dir /path/to/engram
   ```

2. Test the store-recall-forget cycle:
   ```
   /remember Test memory: the sky is blue
   /recall sky
   /forget sky
   /memory-status
   ```

3. Verify the Stop hook fires on session end and stores memories.

### MCP Server Testing

Test the MCP server standalone:

```bash
cd mcp && bun run dev
```

Then send JSON-RPC messages on stdin to test tools directly.

### Type Checking

```bash
cd mcp && bun run typecheck
```

Run this before committing to catch type errors. The project uses TypeScript
strict mode, so most common mistakes are caught at compile time.

### Future: Automated Tests

When the project matures, add test files in `mcp/src/__tests__/`:

- Unit tests for `SurrealDBClient` methods (mock the `surrealdb` package)
- Integration tests that spin up an embedded SurrealKV and run the full cycle
- Tool tests that verify MCP tool input/output contracts

Use `bun test` as the test runner (built into Bun).

## Implementation Phases

The project follows a phased implementation plan. See `CLAUDE.md` for the full
checklist.

| Phase | Focus | Status |
|-------|-------|--------|
| Phase 1 | MVP: core tools, BM25 search, basic hooks | Current |
| Phase 2 | Vector search (HNSW), knowledge graph, embeddings | Planned |
| Phase 3 | Self-evolution: decay, consolidation, lifecycle | Planned |
| Phase 4 | Multi-deployment, setup wizard, migration | Planned |

When contributing, check which phase a feature belongs to and ensure Phase 1
fundamentals are solid before building on them.
