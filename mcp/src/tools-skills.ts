import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SurrealDBClient } from "./surrealdb-client.js";
import { validateSurql } from "./security/surql-validator.js";

/**
 * Extract SurrealQL from a memory's content by looking for ```surql code fences.
 * Returns the first match or null.
 */
function extractSurql(content: string): string | null {
  const match = content.match(/```surql\s*\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

export function registerSkillTools(server: McpServer, db: SurrealDBClient): void {
  // recall_skill — find and optionally execute stored SurrealQL patterns
  server.tool(
    "recall_skill",
    "Find stored SurrealQL skill patterns (procedural memories tagged #surql-skill). Optionally execute the found skill against the database.",
    {
      task_description: z.string().describe("Description of what you want to accomplish"),
      execute: z.boolean().optional().describe("Execute the found skill's SurrealQL (default: false)"),
      scope: z.enum(["session", "project", "user"]).optional().describe("Scope to search and execute in"),
    },
    async ({ task_description, execute, scope }) => {
      try {
        // Search procedural memories matching the task description
        const memories = await db.recallMemories({
          query: task_description,
          memoryType: "procedural",
          scope,
          limit: 10,
        });

        // Filter to those tagged with #surql-skill
        const skills = (memories as Record<string, unknown>[]).filter((m) => {
          const tags = m.tags;
          return Array.isArray(tags) && tags.includes("#surql-skill");
        });

        if (skills.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                found: false,
                message: "No matching #surql-skill procedural memories found",
                query: task_description,
                total_procedural_results: memories.length,
              }, null, 2),
            }],
          };
        }

        // If not executing, just return the skills
        if (!execute) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                found: true,
                count: skills.length,
                skills: skills.map((s) => ({
                  id: s.id,
                  content: s.content,
                  tags: s.tags,
                  importance: s.importance,
                  access_count: s.access_count,
                })),
              }, null, 2),
            }],
          };
        }

        // Execute the first matching skill
        const skill = skills[0];
        const surql = extractSurql(skill.content as string);

        if (!surql) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                found: true,
                executed: false,
                error: "Skill found but no ```surql code fence in content",
                skill_id: skill.id,
                content: skill.content,
              }, null, 2),
            }],
          };
        }

        // Validate the extracted SurrealQL
        const validation = validateSurql(surql, false);
        if (!validation.valid) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                found: true,
                executed: false,
                error: "Skill SurrealQL failed validation",
                validation_errors: validation.errors,
                surql,
                skill_id: skill.id,
              }, null, 2),
            }],
            isError: true,
          };
        }

        // Execute in the target scope
        const targetScope = scope ?? "project";
        const start = performance.now();
        const rows = await db.queryInScope(targetScope, surql);
        const elapsed = Math.round(performance.now() - start);

        // Update execution count on the skill memory
        if (skill.id) {
          try {
            const skillScope = (skill._scope as string) ?? targetScope;
            await db.queryInScope(skillScope,
              `UPDATE $id SET metadata.execution_count = (metadata.execution_count ?? 0) + 1, last_accessed_at = time::now(), updated_at = time::now()`,
              { id: skill.id }
            );
          } catch {
            // Non-critical — don't fail the execution result
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              found: true,
              executed: true,
              skill_id: skill.id,
              scope: targetScope,
              query_time_ms: elapsed,
              results: rows,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error recalling skill: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // mark_retrieval_useful — explicit feedback on retrieval quality
  server.tool(
    "mark_retrieval_useful",
    "Provide explicit feedback on whether a recent memory retrieval was useful. Updates the most recent matching retrieval_log entry.",
    {
      query: z.string().describe("The original search query to match against retrieval_log"),
      was_useful: z.boolean().describe("Whether the retrieval results were useful"),
      reason: z.string().optional().describe("Optional explanation of why it was or wasn't useful"),
    },
    async ({ query, was_useful, reason }) => {
      try {
        // Find the most recent matching retrieval_log entry in project scope
        const logs = await db.queryInScope("project",
          `SELECT * FROM retrieval_log
            WHERE query = $query AND event_type = 'search'
            ORDER BY created_at DESC LIMIT 1`,
          { query }
        );

        const log = (logs as Record<string, unknown>[])[0];
        if (!log?.id) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                updated: false,
                message: `No retrieval_log entry found for query: "${query}"`,
              }, null, 2),
            }],
          };
        }

        // Update the log entry with feedback
        const vars: Record<string, unknown> = {
          id: log.id,
          was_useful,
        };

        let surql = `UPDATE $id SET was_useful = $was_useful, updated_at = time::now()`;
        if (reason !== undefined) {
          surql += `, metadata.feedback_reason = $reason`;
          vars.reason = reason;
        }

        await db.queryInScope("project", surql, vars);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              updated: true,
              retrieval_log_id: log.id,
              was_useful,
              reason: reason ?? null,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error marking retrieval: ${err}` }],
          isError: true,
        };
      }
    }
  );
}
