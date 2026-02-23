---
name: memory-admin
description: |
  Use this skill for memory system administration tasks: viewing stats,
  managing deployment modes, bulk operations on memories, database maintenance,
  and troubleshooting connection issues. Triggers on: "memory admin", "memory stats",
  "memory maintenance", "clean up memories", "memory database", "switch memory mode".
---

# Memory Administration

## Status and Diagnostics

Use `get_memory_status` to check connection health. For deeper diagnostics, query directly:

```
-- Count by scope
SELECT scope, count() FROM memory WHERE status = 'active' GROUP BY scope;

-- Count by type
SELECT memory_type, count() FROM memory WHERE status = 'active' GROUP BY memory_type;

-- Oldest and newest memories
SELECT id, content, created_at FROM memory ORDER BY created_at ASC LIMIT 3;
SELECT id, content, created_at FROM memory ORDER BY created_at DESC LIMIT 3;

-- Most accessed memories
SELECT id, content, access_count, importance FROM memory
  WHERE status = 'active' ORDER BY access_count DESC LIMIT 10;

-- Knowledge graph stats
SELECT entity_type, count() FROM entity GROUP BY entity_type;
SELECT count() FROM relates_to;

-- Consolidation queue status
SELECT status, count() FROM consolidation_queue GROUP BY status;
```

## Bulk Operations

### Archive stale memories
```
UPDATE memory SET status = 'archived', updated_at = time::now()
  WHERE status = 'active'
    AND importance < 0.2
    AND access_count = 0
    AND created_at < time::now() - 30d;
```

### Promote all high-value session memories
```
UPDATE memory SET scope = 'project', updated_at = time::now()
  WHERE status = 'active'
    AND scope = 'session'
    AND (importance >= 0.7 OR access_count >= 3);
```

### Purge forgotten memories permanently
```
DELETE FROM memory WHERE status = 'forgotten' AND updated_at < time::now() - 90d;
```

## Deployment Mode Management

Current mode is set via `SURREAL_MODE` env var or `.claude/surrealdb-memory.local.md`.

| Mode | Endpoint | Persistence |
|------|----------|-------------|
| `embedded` | `surrealkv://{data_path}` | Persistent file-based |
| `memory` | `mem://` | Ephemeral (snapshot on close) |
| `local` | `ws://localhost:8000` | Depends on server config |
| `remote` | `wss://...` | Cloud-managed |

To switch modes, use the `/memory-setup` command or edit `.claude/surrealdb-memory.local.md`.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "SurrealDB not connected" | Server not running or bad endpoint | Check mode and URL config |
| Empty recall results | No memories stored yet, or wrong scope filter | Try broader search, check scope |
| Slow queries | Large dataset without proper indexes | Schema auto-creates indexes; check with `INFO FOR TABLE memory` |
| "record not found" on update | Wrong memory ID format | IDs look like `memory:abc123` — include the table prefix |
| Snapshot export fails | Data path not writable | Check permissions on `~/.claude/surrealdb-memory/data` |
