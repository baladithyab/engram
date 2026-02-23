---
name: memory-status
description: Show the status of the SurrealDB memory system — connection, counts, and configuration.
---

Use the `get_memory_status` MCP tool to fetch current status. Display:

- Connection status (connected/disconnected)
- Deployment mode (embedded/local/remote)
- Memory counts by scope (session/project/user)
- Memory counts by type (episodic/semantic/procedural)
- Entity count in knowledge graph
- Database size if available
