---
name: forget
description: Remove a memory from SurrealDB. Soft-deletes by marking as forgotten.
allowed-tools: ["recall_memories", "forget_memory"]
argument-hint: "<what to forget>"
arguments:
  - name: query
    description: Search query to find the memory to forget
    required: true
---

First search for matching memories using `recall_memories`. Show the results and ask
which one(s) to forget. Then use `forget_memory` to soft-delete the selected memories.

Always confirm before forgetting. Show what will be forgotten and ask for confirmation.
