---
name: remember
description: Store a memory in SurrealDB. Persists knowledge, decisions, patterns, or experiences across sessions.
arguments:
  - name: content
    description: What to remember (optional — if omitted, prompts interactively)
    required: false
---

Store a memory using the `store_memory` MCP tool from the surrealdb-memory server.

If content was provided as an argument, store it directly. Otherwise, ask what to remember.

For each memory, determine:
1. **Type**: episodic (event/conversation), semantic (fact/knowledge), procedural (skill/pattern)
2. **Scope**: session (temporary), project (this codebase), user (cross-project)
3. **Tags**: relevant keywords for categorization
4. **Importance**: 0-1 scale (default 0.5, use 0.8+ for critical knowledge)

Use the `store_memory` tool to persist the memory. Confirm what was stored.
