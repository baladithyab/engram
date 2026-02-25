# Engram Evolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename surrealdb-memory to Engram, close Phase 1 EURM gaps, add embedding pipeline, Code Mode interface, recursive memory processing, and MemEvolve meta-evolution.

**Architecture:** 4-agent team on isolated worktrees. Agent 1 (Foundation) runs first on the feature branch. Agents 2-4 run in parallel on worktrees after Agent 1 completes. All merge back to `feature/engram-evolution` for PR to main.

**Tech Stack:** Bun + TypeScript, SurrealDB 3.0 (@surrealdb/node), @xenova/transformers (ONNX embeddings), @modelcontextprotocol/sdk

---

## Pre-Work: Branch Setup

**Step 1: Create feature branch**

```bash
cd /Users/baladita/Documents/DevBox/surrealdb-memory
git checkout -b feature/engram-evolution
```

---

## Agent 1: Foundation (Rename + Phase 1 EURM Closure)

> This agent runs on `feature/engram-evolution` directly. Must complete before Agents 2-4 start.

### Task 1.1: Rename plugin manifest and MCP config

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.mcp.json`
- Modify: `mcp/package.json`

**Step 1: Update plugin.json**

Change `name` from `"surrealdb-memory"` to `"engram"`.

```json
{
  "name": "engram",
  "version": "0.2.0",
  "description": "Persistent, hierarchical, self-evolving memory for Claude Code powered by SurrealDB",
  "author": "baladita",
  "hooks": "hooks/hooks.json",
  "mcpServers": ".mcp.json"
}
```

**Step 2: Update .mcp.json**

Change server name and default data path:

```json
{
  "mcpServers": {
    "engram": {
      "command": "bun",
      "args": ["run", "${CLAUDE_PLUGIN_ROOT}/mcp/src/index.ts"],
      "env": {
        "SURREAL_MODE": "embedded",
        "SURREAL_DATA_PATH": "${HOME}/.claude/engram/data"
      }
    }
  }
}
```

**Step 3: Update mcp/package.json**

```json
{
  "name": "engram-mcp",
  "version": "0.2.0",
  "description": "MCP server for Engram — SurrealDB-backed Claude Code memory"
}
```

**Step 4: Typecheck**

Run: `cd mcp && bun run typecheck`

**Step 5: Commit**

```bash
git add .claude-plugin/plugin.json .mcp.json mcp/package.json
git commit -m "Rename surrealdb-memory to engram in manifests"
```

### Task 1.2: Rename MCP server entry point

**Files:**
- Modify: `mcp/src/index.ts:9,22,54`

**Step 1: Update server name and default path**

In `mcp/src/index.ts`:
- Line 9: Change `name: "surrealdb-memory"` to `name: "engram"`
- Line 22: Change default dataPath from `~/.claude/surrealdb-memory/data` to `~/.claude/engram/data`
- Line 54: Change error message from `"surrealdb-memory MCP server"` to `"engram MCP server"`

**Step 2: Typecheck and commit**

```bash
cd mcp && bun run typecheck
git add mcp/src/index.ts
git commit -m "Rename MCP server to engram"
```

### Task 1.3: Rename config reader and client paths

**Files:**
- Modify: `mcp/src/surrealdb-client.ts:48,59,156,167,429`

**Step 1: Update config file path**

In `readConfig()` (line 59): Change `"surrealdb-memory.local.md"` to `"engram.local.md"`. Add fallback to old path:

```typescript
export function readConfig(projectRoot?: string): Partial<SurrealDBConfig> {
  const roots = [
    projectRoot,
    process.env.CLAUDE_PROJECT_ROOT,
    process.cwd(),
  ].filter(Boolean) as string[];

  // Try new name first, fall back to old name for migration
  const configNames = ["engram.local.md", "surrealdb-memory.local.md"];

  for (const root of roots) {
    for (const name of configNames) {
      const configPath = join(root, ".claude", name);
      if (!existsSync(configPath)) continue;
      // ... rest of parsing unchanged
    }
  }
  return {};
}
```

**Step 2: Update default data paths**

In `resolveEndpoint()` (lines 156, 167): Change `~/.claude/surrealdb-memory/data` to `~/.claude/engram/data`.

In `exportMemorySnapshot()` (line 429): Same path change.

**Step 3: Typecheck and commit**

```bash
cd mcp && bun run typecheck
git add mcp/src/surrealdb-client.ts
git commit -m "Rename config paths to engram with fallback"
```

### Task 1.4: Rename hook scripts

**Files:**
- Modify: `hooks/scripts/config.sh:3,14,21-24`
- Modify: `hooks/scripts/auto-approve-memory.sh`
- Modify: `hooks/hooks.json:60,70`

**Step 1: Update config.sh**

- Line 3: Comment → `"engram hook scripts"`
- Line 14: Default path → `$HOME/.claude/engram/data`
- Lines 21-24: Config search paths → `"engram.local.md"` with `"surrealdb-memory.local.md"` as fallback

```bash
_CONFIG_SEARCH_PATHS=(
  "${CLAUDE_PROJECT_ROOT:-.}/.claude/engram.local.md"
  "${CLAUDE_PROJECT_ROOT:-.}/.claude/surrealdb-memory.local.md"
  "${PWD}/.claude/engram.local.md"
  "${PWD}/.claude/surrealdb-memory.local.md"
)
```

**Step 2: Update auto-approve-memory.sh**

Add the new Phase 3-5 tool names to the approval list:

```bash
case "$TOOL_NAME" in
  store_memory|recall_memories|forget_memory|get_memory_status|promote_memory|update_memory|tag_memory|search_knowledge_graph|reflect_and_consolidate|engram_explore|engram_execute|recall_skill|mark_retrieval_useful|memory_peek|memory_partition|memory_aggregate|evolve_memory_system)
    echo '{"decision": "allow"}'
    exit 0
    ;;
esac
```

**Step 3: Update hooks.json prompt references**

Lines 60, 70: Change `"surrealdb-memory MCP server"` to `"engram MCP server"`.

**Step 4: Commit**

```bash
git add hooks/
git commit -m "Rename hook scripts to engram"
```

### Task 1.5: Rename all documentation references

**Files:**
- Modify: `CLAUDE.md` — replace all `surrealdb-memory` with `engram`
- Modify: All files in `docs/` — same replacement
- Modify: All files in `commands/`, `skills/`, `agents/` — same replacement

**Step 1: Bulk rename with grep + sed**

```bash
# Find all files containing old name
grep -rl "surrealdb-memory" --include="*.md" --include="*.json" . | head -50

# Replace in all markdown files (NOT in .git or node_modules)
find . -name "*.md" -not -path "./.git/*" -not -path "*/node_modules/*" -exec sed -i '' 's/surrealdb-memory/engram/g' {} +

# Verify no stale references remain (except git history)
grep -r "surrealdb-memory" --include="*.md" --include="*.json" --include="*.ts" --include="*.sh" . | grep -v node_modules | grep -v .git
```

**Step 2: Commit**

```bash
git add -A
git commit -m "Rename all documentation references to engram"
```

### Task 1.6: Wire PostToolUse hooks (Encode step)

**Files:**
- Modify: `hooks/scripts/post-file-change.sh` (replace entire content)
- Modify: `hooks/scripts/post-bash-error.sh` (replace entire content)

**Step 1: Implement post-file-change.sh**

The hook must output JSON that Claude Code interprets. Since embedded mode has no HTTP API, and we can't call the MCP server directly from a bash hook, the hook outputs a prompt instruction that tells Claude to store the memory on its next turn.

```bash
#!/bin/bash
# PostToolUse hook: fires after Write or Edit tool use.
# Outputs a prompt for Claude to store the file change as episodic memory.

source "$(dirname "$0")/config.sh" 2>/dev/null || true

TOOL_NAME="${1:-unknown}"
TOOL_INPUT="${2:-}"

FILE_PATH=""
if command -v jq &>/dev/null && [ -n "$TOOL_INPUT" ]; then
  FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // .path // empty' 2>/dev/null)
fi

if [ -n "$FILE_PATH" ]; then
  log_info "File changed via ${TOOL_NAME}: ${FILE_PATH}"
  # Output nothing — the Stop hook handles batch consolidation.
  # Logging ensures the change is tracked for the session review.
fi

exit 0
```

Note: After analysis, PostToolUse command hooks can't call MCP tools (they run in a subprocess). The Stop prompt hook is the correct place to call `store_memory`. The PostToolUse hooks log file changes and errors to the hook log file. The Stop hook prompt already instructs Claude to review the session and store learnings. This is the correct MemEvolve pattern — batch encoding at session end rather than per-tool-call.

**Step 2: Implement post-bash-error.sh**

Same approach — log for session review, Stop hook handles storage:

```bash
#!/bin/bash
# PostToolUse hook: fires after Bash tool returns non-zero exit code.
# Logs errors for session review. Stop hook handles memory storage.

source "$(dirname "$0")/config.sh" 2>/dev/null || true

TOOL_INPUT="${1:-}"
TOOL_OUTPUT="${2:-}"

COMMAND=""
if command -v jq &>/dev/null && [ -n "$TOOL_INPUT" ]; then
  COMMAND=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null)
fi

if [ -n "$COMMAND" ]; then
  SHORT_OUTPUT=$(echo "$TOOL_OUTPUT" | head -c 500)
  log_warn "Bash error: ${COMMAND} -> ${SHORT_OUTPUT}"
fi

exit 0
```

**Step 3: Commit**

```bash
git add hooks/scripts/post-file-change.sh hooks/scripts/post-bash-error.sh
git commit -m "Clarify PostToolUse hooks as loggers for Stop hook consolidation"
```

### Task 1.7: Wire SessionStart to query real memories

**Files:**
- Modify: `hooks/scripts/session-start.sh`

**Step 1: Replace session-start.sh**

The SessionStart hook is a `command` type, so it outputs JSON to stdout. It can't call MCP tools directly, but it can output a prompt that includes memory context guidance AND instruct Claude to call `recall_memories` as its first action.

```bash
#!/bin/bash
# SessionStart hook: inject memory system context and instruct recall.
source "$(dirname "$0")/config.sh" 2>/dev/null || true

DATA_PATH="${SURREAL_DATA_PATH:-$HOME/.claude/engram/data}"

# Check if database exists (embedded mode)
DB_EXISTS=false
if [ -d "$DATA_PATH" ]; then
  DB_EXISTS=true
fi

cat << 'CONTEXT_JSON'
{
  "type": "additionalContext",
  "context": "## Engram Memory System Active\n\nYou have persistent hierarchical memory via the Engram MCP plugin.\n\n### Memory Scopes\n- **Session**: Current conversation only (highest relevance weight 1.5x)\n- **Project**: Persists across sessions for this codebase (1.0x weight)\n- **User**: Cross-project knowledge (0.7x weight)\n\n### Available Tools\n- `recall_memories` — Search memories by query (BM25 + strength weighting)\n- `store_memory` — Store with type (episodic/semantic/procedural/working) and scope\n- `reflect_and_consolidate` — Promote, archive, and deduplicate\n- `engram_explore` — Progressive discovery of memory contents\n- `engram_execute` — Run arbitrary SurrealQL queries\n- `recall_skill` — Find stored SurrealQL query patterns\n- `memory_peek` / `memory_partition` / `memory_aggregate` — Recursive large-scale retrieval\n\n### First Action\nSilently call `recall_memories` with a query relevant to the user's likely intent (infer from project context). Inject useful memories into your working context without mentioning the memory system."
}
CONTEXT_JSON

exit 0
```

**Step 2: Commit**

```bash
git add hooks/scripts/session-start.sh
git commit -m "SessionStart hook outputs memory context and recall instruction"
```

### Task 1.8: Use memory_strength in retrieval + write retrieval_log

**Files:**
- Modify: `mcp/src/surrealdb-client.ts` — `recallMemories()` method (lines 279-358)

**Step 1: Update recallMemories to use memory_strength and log retrievals**

In `recallMemories()`, change the query builder and add retrieval logging:

```typescript
async recallMemories(params: {
  query: string;
  scope?: string;
  memoryType?: string;
  limit?: number;
}): Promise<unknown[]> {
  const buildQuery = () => {
    let surql = `SELECT *, search::score(1) AS relevance, memory_strength
      FROM memory
      WHERE content @1@ $query
        AND status = 'active'`;

    if (params.memoryType) {
      surql += ` AND memory_type = $memory_type`;
    }

    // Composite ranking: 60% BM25 relevance + 40% memory strength
    surql += ` ORDER BY (search::score(1) * 0.6 + memory_strength * 0.4) DESC LIMIT $limit`;
    return surql;
  };

  // ... existing scope search logic unchanged ...

  // After collecting allMemories, log the retrieval
  try {
    await this.withScope("project", async () => {
      await this.db.query(
        `CREATE retrieval_log SET
          event_type = 'search',
          query = $query,
          strategy = 'bm25',
          results_count = $count,
          memory_ids = $ids,
          session_id = $session_id,
          created_at = time::now()`,
        {
          query: params.query,
          count: allMemories.length,
          ids: allMemories.filter((m: any) => m?.id).map((m: any) => m.id),
          session_id: this.scopeIds.sessionId,
        }
      );
    });
  } catch {
    // Non-critical — log failure shouldn't break recall
  }

  return allMemories;
}
```

**Step 2: Typecheck and commit**

```bash
cd mcp && bun run typecheck
git add mcp/src/surrealdb-client.ts
git commit -m "Use memory_strength in retrieval ranking, write retrieval_log"
```

### Task 1.9: Make consolidation actually consolidate

**Files:**
- Modify: `mcp/src/tools.ts` — `reflect_and_consolidate` tool (lines 312-431)

**Step 1: Wire the archive action for stale memories**

In the `if (!isDryRun)` block (line 385), after the promotion loop, add archival:

```typescript
// Archive stale memories (not just queue them)
for (const mem of report.staleCandidates as any[]) {
  if (mem?.id) {
    await db.query(
      `UPDATE $id SET status = 'archived', status_changed_at = time::now(), updated_at = time::now()`,
      { id: mem.id }
    );
    report.actionsPerformed.push(`Archived ${mem.id} (low strength, low access)`);
  }
}
```

**Step 2: Typecheck and commit**

```bash
cd mcp && bun run typecheck
git add mcp/src/tools.ts
git commit -m "Wire consolidation to actually archive stale memories"
```

### Task 1.10: Seed evolution_state defaults

**Files:**
- Modify: `mcp/src/schema.ts` — add `EVOLUTION_SEED_SQL` to `ALL_SCHEMA_SQL`

**Step 1: Add seed SQL**

```typescript
/** Seed evolution_state with default parameters */
export const EVOLUTION_SEED_SQL = `
  -- Only insert if no existing evolution state (idempotent)
  INSERT INTO evolution_state (key, value, updated_at) VALUES
    ('scope_weights', { session: 1.5, project: 1.0, user: 0.7 }, time::now()),
    ('decay_half_lives', { working: 0.042, episodic: 1.0, semantic: 7.0, procedural: 30.0 }, time::now()),
    ('promotion_thresholds', { importance: 0.5, access_count: 2 }, time::now()),
    ('retrieval_strategy', { default_strategy: 'bm25' }, time::now())
  ON DUPLICATE KEY UPDATE updated_at = updated_at;
`;
```

Add to `ALL_SCHEMA_SQL` array after `EVENTS_SQL`.

**Step 2: Typecheck and commit**

```bash
cd mcp && bun run typecheck
git add mcp/src/schema.ts
git commit -m "Seed evolution_state with default tuning parameters"
```

### Task 1.11: Final verification

**Step 1: Full typecheck**

```bash
cd mcp && bun run typecheck
```

**Step 2: Grep for stale references**

```bash
grep -r "surrealdb-memory" --include="*.ts" --include="*.sh" --include="*.json" --include="*.md" . | grep -v node_modules | grep -v .git | grep -v "docs/plans/"
```

Expected: No results (plans docs may reference old name in historical context — that's OK).

**Step 3: Commit any stragglers**

```bash
git add -A && git status
```

---

## Agent 2: Embeddings (Phase 2)

> Runs on worktree `worktree/embeddings` after Agent 1 completes.

### Task 2.1: Set up worktree

```bash
cd /Users/baladita/Documents/DevBox/surrealdb-memory
git worktree add ../engram-embeddings feature/engram-evolution
cd ../engram-embeddings
git checkout -b embeddings
```

### Task 2.2: Add embedding dependencies

**Files:**
- Modify: `mcp/package.json`

**Step 1: Add @xenova/transformers**

```bash
cd mcp && bun add @xenova/transformers
```

**Step 2: Commit**

```bash
git add mcp/package.json mcp/bun.lockb
git commit -m "Add @xenova/transformers for local embeddings"
```

### Task 2.3: Create embedding provider interface

**Files:**
- Create: `mcp/src/embeddings/provider.ts`

```typescript
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly name: string;
}
```

**Commit:** `git commit -m "Add EmbeddingProvider interface"`

### Task 2.4: Implement local embedding provider

**Files:**
- Create: `mcp/src/embeddings/local.ts`

```typescript
import type { EmbeddingProvider } from "./provider.js";

let pipeline: any = null;

async function getExtractor() {
  if (!pipeline) {
    const { pipeline: createPipeline } = await import("@xenova/transformers");
    pipeline = await createPipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      cache_dir: `${process.env.HOME}/.claude/engram/models`,
    });
  }
  return pipeline;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384;
  readonly name = "local:all-MiniLM-L6-v2";

  async embed(text: string): Promise<number[]> {
    const extractor = await getExtractor();
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array).slice(0, this.dimensions);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
```

**Commit:** `git commit -m "Implement local embedding provider (all-MiniLM-L6-v2)"`

### Task 2.5: Implement API embedding provider

**Files:**
- Create: `mcp/src/embeddings/api.ts`

```typescript
import type { EmbeddingProvider } from "./provider.js";

export interface ApiEmbeddingConfig {
  url: string;
  model: string;
  apiKey: string;
  dimensions?: number;
}

export class ApiEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly name: string;
  private config: ApiEmbeddingConfig;

  constructor(config: ApiEmbeddingConfig) {
    this.config = config;
    this.dimensions = config.dimensions ?? 384;
    this.name = `api:${config.model}`;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: this.config.model,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as { data: { embedding: number[] }[] };
    return json.data[0].embedding.slice(0, this.dimensions);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.config.model,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const json = (await response.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding.slice(0, this.dimensions));
  }
}
```

**Commit:** `git commit -m "Implement API embedding provider (OpenAI-compatible)"`

### Task 2.6: Create embedding factory

**Files:**
- Create: `mcp/src/embeddings/index.ts`

Reads config from `engram.local.md` frontmatter. If `embedding_provider: api` is set, uses ApiProvider. Otherwise LocalProvider. If local fails to load model, logs warning and returns null embeddings.

```typescript
import type { EmbeddingProvider } from "./provider.js";
import { LocalEmbeddingProvider } from "./local.js";
import { ApiEmbeddingProvider } from "./api.js";
import type { EmbeddingConfig } from "./provider.js";

export { type EmbeddingProvider } from "./provider.js";

export function createEmbeddingProvider(config?: {
  provider?: string;
  url?: string;
  model?: string;
  apiKey?: string;
  dimensions?: number;
}): EmbeddingProvider {
  if (config?.provider === "api" && config.url && config.apiKey) {
    return new ApiEmbeddingProvider({
      url: config.url,
      model: config.model ?? "text-embedding-3-small",
      apiKey: config.apiKey,
      dimensions: config.dimensions ?? 384,
    });
  }
  return new LocalEmbeddingProvider();
}
```

**Commit:** `git commit -m "Add embedding provider factory with config-based selection"`

### Task 2.7: Integrate embeddings into store_memory

**Files:**
- Modify: `mcp/src/surrealdb-client.ts` — `storeMemory()` method
- Modify: `mcp/src/index.ts` — pass embedding provider to client

Add an `embedder` property to `SurrealDBClient`. In `storeMemory()`, if embedder is set and no embedding was provided, generate one before INSERT.

**Step 1:** Add embedder to client constructor:

```typescript
constructor(config: SurrealDBConfig, scopeIds?: ScopeIdentifiers, embedder?: EmbeddingProvider) {
  this.config = config;
  this.db = new Surreal();
  this.scopeIds = scopeIds ?? generateScopeIds();
  this.embedder = embedder ?? null;
}
```

**Step 2:** In `storeMemory()`, before the query, generate embedding:

```typescript
let embedding = params.embedding ?? null;
if (!embedding && this.embedder) {
  try {
    embedding = await this.embedder.embed(params.content);
  } catch {
    // Embedding generation is non-critical
  }
}
```

**Step 3:** In `index.ts`, create the provider and pass it:

```typescript
import { createEmbeddingProvider } from "./embeddings/index.js";

const embedder = createEmbeddingProvider({
  provider: fileConfig.embeddingProvider,
  url: fileConfig.embeddingUrl,
  model: fileConfig.embeddingModel,
  apiKey: fileConfig.embeddingApiKey,
  dimensions: fileConfig.embeddingDimensions,
});

const db = new SurrealDBClient(config, scopeIds, embedder);
```

**Step 4: Typecheck and commit**

```bash
cd mcp && bun run typecheck
git add -A
git commit -m "Integrate embedding generation into store_memory pipeline"
```

### Task 2.8: Add hybrid search to recall_memories

**Files:**
- Modify: `mcp/src/surrealdb-client.ts` — `recallMemories()` method

When the embedder is available, generate a query embedding and use hybrid BM25+HNSW ranking:

```typescript
const buildQuery = (hasEmbedding: boolean) => {
  if (hasEmbedding) {
    // Hybrid: BM25 + vector similarity
    return `SELECT *,
      search::score(1) AS bm25_score,
      vector::similarity::cosine(embedding, $embedding) AS vec_score,
      memory_strength
    FROM memory
    WHERE content @1@ $query AND status = 'active'
    ORDER BY (search::score(1) * 0.3 + vector::similarity::cosine(embedding, $embedding) * 0.3 + memory_strength * 0.4) DESC
    LIMIT $limit`;
  }
  // BM25-only fallback
  return `SELECT *, search::score(1) AS bm25_score, memory_strength
    FROM memory
    WHERE content @1@ $query AND status = 'active'
    ORDER BY (search::score(1) * 0.6 + memory_strength * 0.4) DESC
    LIMIT $limit`;
};

let queryEmbedding: number[] | null = null;
if (this.embedder) {
  try {
    queryEmbedding = await this.embedder.embed(params.query);
  } catch { /* non-critical */ }
}
```

Update the retrieval_log strategy field: `strategy: queryEmbedding ? 'hybrid' : 'bm25'`.

**Typecheck and commit:**

```bash
cd mcp && bun run typecheck
git add -A
git commit -m "Add hybrid BM25+HNSW search when embeddings available"
```

### Task 2.9: Update config reader for embedding settings

**Files:**
- Modify: `mcp/src/surrealdb-client.ts` — `readConfig()` function

Add embedding config keys to the YAML parser switch:

```typescript
case "embedding_provider": config.embeddingProvider = _val; break;
case "embedding_url":      config.embeddingUrl = _val; break;
case "embedding_model":    config.embeddingModel = _val; break;
case "embedding_api_key":  config.embeddingApiKey = _val; break;
case "embedding_dimensions": config.embeddingDimensions = parseInt(_val); break;
```

Update the `SurrealDBConfig` interface to include these optional fields.

**Typecheck and commit:**

```bash
cd mcp && bun run typecheck
git add -A
git commit -m "Add embedding config support to config reader"
```

---

## Agent 3: Code Mode (Phase 3)

> Runs on worktree `worktree/codemode` after Agent 1 completes.

### Task 3.1: Set up worktree

```bash
cd /Users/baladita/Documents/DevBox/surrealdb-memory
git worktree add ../engram-codemode feature/engram-evolution
cd ../engram-codemode
git checkout -b codemode
```

### Task 3.2: Create SurrealQL AST validator

**Files:**
- Create: `mcp/src/security/surql-validator.ts`

```typescript
/**
 * SurrealQL safety validator.
 * Allowlists safe statement types, blocklists DDL and namespace-hopping.
 */

const BLOCKED_PATTERNS = [
  /\bDROP\b/i,
  /\bDEFINE\b/i,
  /\bREMOVE\b/i,
  /\bKILL\b/i,
  /\bUSE\s+NS\b/i,
  /\bUSE\s+DB\b/i,
  /\bINFO\s+FOR\b/i,
];

const WRITE_PATTERNS = [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bCREATE\b/i,
  /\bUPSERT\b/i,
  /\bRELATE\b/i,
  /\bDELETE\b/i,
];

export interface ValidationResult {
  valid: boolean;
  requiresWrite: boolean;
  errors: string[];
}

export function validateSurql(surql: string, allowWrites = false): ValidationResult {
  const errors: string[] = [];
  let requiresWrite = false;

  // Strip comments and string literals for analysis
  const normalized = surql
    .replace(/--[^\n]*/g, "")
    .replace(/'[^']*'/g, "'__STR__'")
    .replace(/"[^"]*"/g, '"__STR__"');

  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) {
      errors.push(`Blocked statement detected: ${pattern.source}`);
    }
  }

  // Check for write operations
  for (const pattern of WRITE_PATTERNS) {
    if (pattern.test(normalized)) {
      requiresWrite = true;
      if (!allowWrites) {
        errors.push(`Write operation requires allow_writes=true: ${pattern.source}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    requiresWrite,
    errors,
  };
}
```

**Commit:** `git commit -m "Add SurrealQL AST validator with allowlist/blocklist"`

### Task 3.3: Create engram_explore tool

**Files:**
- Create: `mcp/src/tools-codemode.ts`

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SurrealDBClient } from "./surrealdb-client.js";
import { validateSurql } from "./security/surql-validator.js";

export function registerCodeModeTools(server: McpServer, db: SurrealDBClient): void {

  server.tool(
    "engram_explore",
    "Progressively discover memory store contents. Depth 0: scope counts. Depth 1: table stats. Depth 2: schema info. Depth 3: sample records.",
    {
      depth: z.number().min(0).max(3).optional().describe("Discovery depth 0-3, default 0"),
      scope: z.enum(["session", "project", "user", "all"]).optional().describe("Which scope to explore"),
      table: z.string().optional().describe("Table name for depth 2-3 (memory, entity, relates_to, etc.)"),
      sample_size: z.number().optional().describe("Number of sample records at depth 3, default 3"),
    },
    async ({ depth, scope, table, sample_size }) => {
      try {
        const d = depth ?? 0;
        let result: unknown;

        if (d === 0) {
          // Layer 0: scope counts
          const status = await db.getStatus();
          result = {
            scopes: status.scopes,
            totalMemories: status.totalMemories,
            totalEntities: status.totalEntities,
            mode: status.mode,
          };
        } else if (d === 1) {
          // Layer 1: table stats per scope
          const scopes = scope === "all" ? ["session", "project", "user"] : [scope ?? "project"];
          const stats: Record<string, unknown> = {};
          for (const s of scopes) {
            const counts = await db.queryInScope(s, `
              SELECT
                (SELECT count() FROM memory GROUP ALL)[0].count AS memory_count,
                (SELECT count() FROM entity GROUP ALL)[0].count AS entity_count,
                (SELECT count() FROM relates_to GROUP ALL)[0].count AS relation_count,
                (SELECT count() FROM retrieval_log GROUP ALL)[0].count AS log_count,
                (SELECT count() FROM evolution_state GROUP ALL)[0].count AS evolution_count
            `);
            stats[s] = counts;
          }
          result = stats;
        } else if (d === 2) {
          // Layer 2: schema info for a table
          const t = table ?? "memory";
          result = {
            table: t,
            note: "Use engram_execute to query this table with SurrealQL",
            schema_hint: t === "memory"
              ? "Fields: content(string), memory_type(enum), scope(enum), tags(array), embedding(float[384]), importance(float), confidence(float), access_count(int), status(enum), memory_strength(computed), created_at, updated_at, last_accessed_at, metadata(flexible object)"
              : t === "entity"
              ? "Fields: name(string), entity_type(string), description(string), embedding(float[384]), mention_count(int), confidence(float), scope(string)"
              : t === "relates_to"
              ? "RELATION FROM entity TO entity. Fields: relation_type(string), weight(float), confidence(float), scope(string), evidence(string[])"
              : "Use depth 1 to see available tables",
          };
        } else {
          // Layer 3: sample records
          const t = table ?? "memory";
          const n = sample_size ?? 3;
          const s = scope ?? "project";
          const samples = await db.queryInScope(s,
            `SELECT * FROM type::table($table) LIMIT $limit`,
            { table: t, limit: n }
          );
          result = { table: t, scope: s, samples };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error exploring: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "engram_execute",
    "Execute SurrealQL queries against the memory database. Enables complex compositions: multi-scope filters, graph traversals, aggregations. Read-only by default.",
    {
      surql: z.string().describe("SurrealQL query to execute"),
      scope: z.enum(["session", "project", "user"]).optional().describe("Which scope database to query (default: project)"),
      allow_writes: z.boolean().optional().describe("Set true for INSERT/UPDATE/DELETE (default: false)"),
    },
    async ({ surql, scope, allow_writes }) => {
      try {
        const validation = validateSurql(surql, allow_writes ?? false);
        if (!validation.valid) {
          return {
            content: [{ type: "text" as const, text: `Query rejected:\n${validation.errors.join("\n")}` }],
            isError: true,
          };
        }

        const targetScope = scope ?? "project";
        const start = Date.now();
        const result = await db.queryInScope(targetScope, surql);
        const elapsed = Date.now() - start;

        const flat = (result as any[]).flat();
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              rows: flat.length,
              query_time_ms: elapsed,
              scope: targetScope,
              requires_write: validation.requiresWrite,
              results: flat,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `SurrealQL error: ${err}` }],
          isError: true,
        };
      }
    }
  );
}
```

Note: This requires adding a public `queryInScope()` method to `SurrealDBClient` that wraps `withScope()`:

```typescript
// Add to SurrealDBClient
async queryInScope<T = unknown>(scope: string, surql: string, vars?: Record<string, unknown>): Promise<T[]> {
  return this.withScope(scope, async () => {
    const result = await this.db.query(surql, vars);
    return result.flat() as T[];
  });
}
```

**Commit:** `git commit -m "Add engram_explore and engram_execute Code Mode tools"`

### Task 3.4: Create recall_skill and mark_retrieval_useful tools

**Files:**
- Create: `mcp/src/tools-skills.ts`

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SurrealDBClient } from "./surrealdb-client.js";
import { validateSurql } from "./security/surql-validator.js";

export function registerSkillTools(server: McpServer, db: SurrealDBClient): void {

  server.tool(
    "recall_skill",
    "Find stored SurrealQL query patterns (skills). These are procedural memories tagged #surql-skill that were effective in past sessions.",
    {
      task_description: z.string().describe("What you're trying to do — finds the most relevant stored skill"),
      execute: z.boolean().optional().describe("If true, run the skill query and return results"),
      scope: z.enum(["session", "project", "user"]).optional(),
    },
    async ({ task_description, execute, scope }) => {
      try {
        // Search for skills across scopes
        const skills = await db.recallMemories({
          query: task_description,
          memoryType: "procedural",
          scope,
          limit: 5,
        });

        // Filter to only #surql-skill tagged memories
        const surqlSkills = (skills as any[]).filter(
          (s) => s?.tags?.includes("#surql-skill")
        );

        if (surqlSkills.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No matching SurrealQL skills found. You can create one by storing a procedural memory with tag '#surql-skill'." }],
          };
        }

        // Optionally execute the top skill
        if (execute && surqlSkills[0]?.content) {
          const skillContent = surqlSkills[0].content;
          // Extract the SurrealQL from the skill content (between code fences or raw)
          const surqlMatch = skillContent.match(/```surql?\n([\s\S]*?)```/) ?? [null, skillContent];
          const surql = (surqlMatch[1] ?? skillContent).trim();

          const validation = validateSurql(surql);
          if (!validation.valid) {
            return {
              content: [{ type: "text" as const, text: `Skill found but query is unsafe:\n${validation.errors.join("\n")}\n\nSkill content:\n${skillContent}` }],
            };
          }

          const result = await db.queryInScope(scope ?? "project", surql);

          // Update execution count in skill metadata
          if (surqlSkills[0].id) {
            await db.query(
              `UPDATE $id SET metadata.execution_count = (metadata.execution_count ?? 0) + 1, last_accessed_at = time::now(), access_count += 1`,
              { id: surqlSkills[0].id }
            );
          }

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ skill: surqlSkills[0], execution_result: (result as any[]).flat() }, null, 2),
            }],
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(surqlSkills, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error recalling skill: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "mark_retrieval_useful",
    "After using recalled memories, mark whether they were useful. This feedback trains the memory system to improve over time.",
    {
      query: z.string().describe("The original recall query"),
      was_useful: z.boolean().describe("Were the results helpful?"),
      reason: z.string().optional().describe("Why or why not"),
    },
    async ({ query, was_useful, reason }) => {
      try {
        await db.queryInScope("project",
          `UPDATE retrieval_log SET was_useful = $useful, metadata = { reason: $reason }
           WHERE query = $query ORDER BY created_at DESC LIMIT 1`,
          { query, useful: was_useful, reason: reason ?? null }
        );
        return {
          content: [{ type: "text" as const, text: `Retrieval feedback recorded: ${was_useful ? "useful" : "not useful"}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error recording feedback: ${err}` }],
          isError: true,
        };
      }
    }
  );
}
```

**Commit:** `git commit -m "Add recall_skill and mark_retrieval_useful tools"`

### Task 3.5: Register new tools in index.ts

**Files:**
- Modify: `mcp/src/index.ts`

Add imports and registration calls:

```typescript
import { registerCodeModeTools } from "./tools-codemode.js";
import { registerSkillTools } from "./tools-skills.js";

// After existing registrations:
registerCodeModeTools(server, db);
registerSkillTools(server, db);
```

**Typecheck and commit:**

```bash
cd mcp && bun run typecheck
git add -A
git commit -m "Register Code Mode and Skills tools in MCP server"
```

---

## Agent 4: Recursive + Evolution (Phase 4+5)

> Runs on worktree `worktree/recursive` after Agent 1 completes.

### Task 4.1: Set up worktree

```bash
cd /Users/baladita/Documents/DevBox/surrealdb-memory
git worktree add ../engram-recursive feature/engram-evolution
cd ../engram-recursive
git checkout -b recursive
```

### Task 4.2: Create RRF implementation

**Files:**
- Create: `mcp/src/aggregation/rrf.ts`

```typescript
/**
 * Reciprocal Rank Fusion — merges multiple ranked result lists.
 * RRF score: sum(1 / (k + rank_i(d))) across all lists.
 */

export interface RankedResult {
  id: string;
  data: unknown;
  source: string;
}

export interface RRFResult {
  id: string;
  data: unknown;
  rrf_score: number;
  sources: string[];
}

export function reciprocalRankFusion(
  resultSets: { source: string; results: RankedResult[] }[],
  k = 60,
  limit = 10,
): RRFResult[] {
  const scores = new Map<string, { score: number; data: unknown; sources: Set<string> }>();

  for (const { source, results } of resultSets) {
    for (let rank = 0; rank < results.length; rank++) {
      const item = results[rank];
      const existing = scores.get(item.id);
      const rrfScore = 1 / (k + rank + 1);

      if (existing) {
        existing.score += rrfScore;
        existing.sources.add(source);
      } else {
        scores.set(item.id, {
          score: rrfScore,
          data: item.data,
          sources: new Set([source]),
        });
      }
    }
  }

  return Array.from(scores.entries())
    .map(([id, { score, data, sources }]) => ({
      id,
      data,
      rrf_score: score,
      sources: Array.from(sources),
    }))
    .sort((a, b) => b.rrf_score - a.rrf_score)
    .slice(0, limit);
}
```

**Commit:** `git commit -m "Add Reciprocal Rank Fusion implementation"`

### Task 4.3: Create recursive memory tools

**Files:**
- Create: `mcp/src/tools-recursive.ts`

Implement `memory_peek`, `memory_partition`, `memory_aggregate` — all three tools following the patterns defined in the design doc. Each tool uses `db.queryInScope()` for scope-aware queries and returns JSON results.

`memory_peek`: Queries count by type, count by status, tag frequency top 20, date range, N samples.

`memory_partition`: Groups memories by the chosen partition key and returns descriptors.

`memory_aggregate`: Takes result arrays and applies `reciprocalRankFusion()`.

**Commit:** `git commit -m "Add recursive memory tools (peek, partition, aggregate)"`

### Task 4.4: Create evolution analysis module

**Files:**
- Create: `mcp/src/evolution/analyze.ts`

```typescript
export interface StrategyAnalysis {
  strategy: string;
  total_calls: number;
  useful_count: number;
  useless_count: number;
  unknown_count: number;
  effectiveness: number; // useful / (useful + useless), NaN if no feedback
}

export interface ScopeAnalysis {
  scope: string;
  total_retrieved: number;
  useful_count: number;
  effectiveness: number;
}

export function analyzeStrategies(logs: any[]): StrategyAnalysis[] {
  const byStrategy = new Map<string, { useful: number; useless: number; unknown: number; total: number }>();

  for (const log of logs) {
    const strategy = log.strategy ?? "bm25";
    const entry = byStrategy.get(strategy) ?? { useful: 0, useless: 0, unknown: 0, total: 0 };
    entry.total++;
    if (log.was_useful === true) entry.useful++;
    else if (log.was_useful === false) entry.useless++;
    else entry.unknown++;
    byStrategy.set(strategy, entry);
  }

  return Array.from(byStrategy.entries()).map(([strategy, stats]) => ({
    strategy,
    total_calls: stats.total,
    useful_count: stats.useful,
    useless_count: stats.useless,
    unknown_count: stats.unknown,
    effectiveness: stats.useful + stats.useless > 0
      ? stats.useful / (stats.useful + stats.useless)
      : NaN,
  }));
}
```

**Commit:** `git commit -m "Add evolution strategy analysis module"`

### Task 4.5: Create evolution proposal module

**Files:**
- Create: `mcp/src/evolution/propose.ts`

Implements bounded parameter proposals. Reads current `evolution_state`, compares against analysis results, proposes changes bounded by ±0.2 for weights and ×0.5-2.0 for half-lives.

**Commit:** `git commit -m "Add bounded evolution parameter proposal module"`

### Task 4.6: Create evolve_memory_system tool

**Files:**
- Create: `mcp/src/tools-evolution.ts`

Implements the `evolve_memory_system` MCP tool that:
1. Reads `retrieval_log` for lookback window
2. Calls `analyzeStrategies()` and `analyzeScopeUtility()`
3. Calls `proposeEvolution()` for bounded parameter updates
4. If not dry_run, writes updates to `evolution_state`
5. Returns analysis + proposals

**Commit:** `git commit -m "Add evolve_memory_system meta-evolution tool"`

### Task 4.7: Register new tools in index.ts

**Files:**
- Modify: `mcp/src/index.ts`

```typescript
import { registerRecursiveTools } from "./tools-recursive.js";
import { registerEvolutionTools } from "./tools-evolution.js";

registerRecursiveTools(server, db);
registerEvolutionTools(server, db);
```

**Typecheck and commit:**

```bash
cd mcp && bun run typecheck
git add -A
git commit -m "Register recursive and evolution tools in MCP server"
```

---

## Integration: Merge and Verify

### Task I.1: Merge worktree branches

```bash
cd /Users/baladita/Documents/DevBox/surrealdb-memory
git checkout feature/engram-evolution

# Merge each agent's branch
git merge embeddings --no-ff -m "Merge Phase 2: embedding pipeline"
git merge codemode --no-ff -m "Merge Phase 3: Code Mode interface"
git merge recursive --no-ff -m "Merge Phase 4+5: recursive + evolution"
```

Resolve any conflicts (primarily in `index.ts` where all agents add imports).

### Task I.2: Final typecheck

```bash
cd mcp && bun run typecheck
```

Fix any type errors from merge.

### Task I.3: Clean up worktrees

```bash
git worktree remove ../engram-embeddings
git worktree remove ../engram-codemode
git worktree remove ../engram-recursive
git branch -d embeddings codemode recursive
```

### Task I.4: Create PR

```bash
gh pr create --title "Rename to Engram + implement Phases 1-5" --body "$(cat <<'EOF'
## Summary
- Rename surrealdb-memory → Engram throughout
- Close Phase 1 EURM gaps (retrieval_log, memory_strength ranking, consolidation)
- Phase 2: Embedding pipeline (local @xenova/transformers + OpenAI-compatible API)
- Phase 3: Code Mode (engram_explore, engram_execute, recall_skill, mark_retrieval_useful)
- Phase 4: Recursive memory (memory_peek, memory_partition, memory_aggregate with RRF)
- Phase 5: MemEvolve (evolve_memory_system with bounded parameter tuning)

## Test plan
- [ ] `cd mcp && bun run typecheck` passes
- [ ] `claude --plugin-dir .` loads without errors
- [ ] `/memory-status` returns connection info
- [ ] `/remember` stores a memory, `/recall` finds it
- [ ] `engram_explore` at depth 0-3 returns progressive detail
- [ ] `engram_execute` rejects DROP TABLE, allows SELECT
- [ ] `evolve_memory_system` with dry_run=true returns analysis

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
