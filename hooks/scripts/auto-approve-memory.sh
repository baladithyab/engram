#!/bin/bash
# Auto-approve engram MCP tool permissions
# Exit 0 = allow, Exit 2 = block
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)

# Auto-approve all engram tools (existing + new Phase 3-5 tools)
case "$TOOL_NAME" in
  store_memory|recall_memories|forget_memory|get_memory_status|promote_memory|update_memory|tag_memory|search_knowledge_graph|reflect_and_consolidate|engram_explore|engram_execute|recall_skill|mark_retrieval_useful|memory_peek|memory_partition|memory_aggregate|evolve_memory_system)
    echo '{"decision": "allow"}'
    exit 0
    ;;
esac

# Don't interfere with other tools
exit 0
