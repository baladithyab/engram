# Memory Best Practices

How to use the memory system effectively. This guide covers what to remember,
how to classify memories, and how to get the most value across sessions.

## What to Remember

### Good Candidates

Store knowledge that will be useful in future sessions:

- **Decisions and rationale** -- "Chose SQS over SNS for the notification queue because we need guaranteed delivery and dead-letter support"
- **Codebase conventions** -- "All React components use functional style with hooks, no class components"
- **Architecture patterns** -- "The payment service uses the saga pattern for multi-step transactions"
- **Error resolutions** -- "The ECONNREFUSED error on port 5432 was caused by Docker network misconfiguration; fix was to use host.docker.internal"
- **Deployment procedures** -- "Production deploys require a PR approval, then `make deploy-prod` from the infra/ directory"
- **User preferences** -- "I prefer explicit error handling over try/catch wrappers"
- **Environment setup** -- "This project requires Node 20, pnpm, and a running Redis instance on port 6379"

### Skip These

Do not store trivial or transient information:

- File listings ("the src/ directory has 12 files")
- Obvious tool output ("ran `ls` and saw file.ts")
- Temporary debugging steps ("added a console.log on line 42")
- Information already in project documentation or README
- Duplicate knowledge that is already stored

The Stop hook applies this filter automatically, but it helps to be intentional
when using `/remember` manually.

## Memory Types

Each memory has a type that describes what kind of knowledge it represents.

### Episodic -- Events and Experiences

Things that happened. Tied to a specific moment or session.

```
> /remember We fixed the auth bug by adding token refresh logic to the middleware.
>           The root cause was expired JWTs not being caught before the API call.
```

Type: `episodic` -- this describes an event (fixing a bug) with context.

**Use for:**
- Bug fixes and what caused them
- Debugging sessions and outcomes
- Conversations with stakeholders about decisions
- Deployment events and incidents

### Semantic -- Facts and Knowledge

Things that are true. Not tied to a specific event.

```
> /remember The API rate limit is 100 requests per minute per API key,
>           enforced by the rate-limiter middleware in src/middleware/rate-limit.ts.
```

Type: `semantic` -- this is a fact about the codebase.

**Use for:**
- Architecture facts ("the database uses PostgreSQL 16 with pgvector")
- Configuration details ("the S3 bucket name is stored in SSM at /app/config/bucket")
- API contracts and constraints
- Library versions and compatibility notes

### Procedural -- Skills and Patterns

How to do things. Step-by-step knowledge.

```
> /remember To add a new API endpoint: 1) create handler in src/handlers/,
>           2) add route in src/routes/index.ts, 3) add schema in src/schemas/,
>           4) write test in tests/handlers/.
```

Type: `procedural` -- this is a how-to pattern.

**Use for:**
- Build and deploy procedures
- Code patterns and templates
- Testing strategies
- Common workflows and recipes

### Working -- Temporary Context

Current task state. Only needed during the active session.

```
> /remember Currently refactoring the UserService class. Halfway through
>           extracting the email methods into a separate EmailService.
>           Still need to update the imports in 3 files.
```

Type: `working` -- temporary context for the current task.

**Use for:**
- Current task progress and state
- Partial results that will be completed later
- Scratch notes during investigation
- Context you want preserved through compaction

Working memories typically stay at session scope and are not promoted.

## Memory Scopes

Scopes determine how long and how widely a memory is accessible.

### Session Scope

**Lifetime:** This conversation only (unless promoted).

Use session scope for:
- Working context and temporary notes
- Intermediate findings during investigation
- Task-specific state

```
store_memory(
  content: "The flaky test in auth.test.ts fails when Redis is slow",
  memory_type: "episodic",
  scope: "session",
  tags: ["testing", "redis", "flaky"],
  importance: 0.4
)
```

### Project Scope

**Lifetime:** Persists across all sessions in this project.

Use project scope for:
- Codebase architecture and conventions
- Common error patterns and fixes
- Build/deploy procedures specific to this project
- Design decisions and their rationale

```
store_memory(
  content: "All database migrations must be backward-compatible because
            we run blue-green deployments with two versions active simultaneously",
  memory_type: "semantic",
  scope: "project",
  tags: ["database", "migrations", "deployment"],
  importance: 0.8
)
```

### User Scope

**Lifetime:** Persists across all projects.

Use user scope for:
- Personal coding preferences and style
- Cross-project patterns and tools
- General knowledge not tied to one codebase

```
store_memory(
  content: "I prefer TypeScript strict mode, explicit return types on
            public functions, and Zod for runtime validation",
  memory_type: "semantic",
  scope: "user",
  tags: ["preferences", "typescript"],
  importance: 0.7
)
```

### Promotion Between Scopes

Memories can be promoted to a higher scope using `promote_memory`:

- **Session to Project** -- when a session finding has lasting value for the codebase
- **Project to User** -- when a project pattern applies across all your work

The memory-consolidator agent handles automatic promotion based on access
frequency and importance. Memories that are accessed across multiple sessions
are strong candidates for promotion.

## Importance Scoring

The `importance` field (0.0 to 1.0) affects how memories rank in search results
and when they decay.

| Score | Meaning | Examples |
|-------|---------|---------|
| 0.1 - 0.3 | Low -- nice to have | Minor observations, temporary notes |
| 0.4 - 0.5 | Medium (default) | General knowledge, routine patterns |
| 0.6 - 0.7 | High | Important conventions, common error fixes |
| 0.8 - 1.0 | Critical | Architecture decisions, security constraints, breaking change warnings |

Guidelines:
- Start with the default (0.5) unless you have a reason to change it
- Use 0.8+ for knowledge that could prevent bugs or outages
- Use 0.3 or lower for speculative or uncertain information
- The system strengthens importance when memories are accessed frequently

## Tags

Tags help with categorization and filtering. Use lowercase, hyphenated tags:

```
tags: ["database", "error-handling", "api-design", "auth"]
```

Good tag categories:
- **Domain:** `auth`, `payments`, `notifications`, `user-management`
- **Type:** `bug-fix`, `architecture`, `convention`, `config`
- **Technology:** `postgresql`, `redis`, `docker`, `typescript`
- **Action:** `deployment`, `testing`, `debugging`, `refactoring`

## How Automatic Hooks Work

### Stop Hook (Session End)

When a conversation ends, the Stop hook prompts Claude to review what happened
and store key learnings. It focuses on:

1. Decisions made and their rationale
2. Patterns discovered in the codebase
3. Errors encountered and how they were fixed
4. Conventions learned

Each item is stored as a separate memory with appropriate type and scope. The
hook only stores genuinely useful knowledge, not trivial operations.

### SessionStart Hook

On session start, the hook loads relevant project-scoped memories into context.
In the MVP, this is a placeholder that will be fully implemented once the MCP
server is running in production.

### PreCompact Hook

Before Claude compacts its context window, this hook preserves important
conversation state that would otherwise be lost. Currently a placeholder
in the MVP.

## How Other Sessions Benefit

Memories stored in one session are available to all future sessions:

1. **Session A** -- you fix a tricky CORS bug. The Stop hook stores the fix as
   a procedural memory at project scope.
2. **Session B** (days later) -- you encounter a similar CORS issue. `/recall CORS`
   retrieves the fix from Session A, saving you from re-diagnosing the problem.
3. **Session C** (different project) -- if you promoted the CORS pattern to user
   scope, it is available here too.

The value compounds over time as the memory system captures more project knowledge.

## Common Patterns

### Start of a New Project

Store the basics early:

```
/remember This is a TypeScript monorepo using pnpm workspaces.
         The API is in packages/api/, the frontend in packages/web/.
         Build with `pnpm build`, test with `pnpm test`.
```

### After Debugging

Capture what you learned:

```
/remember The intermittent 500 errors on /api/users were caused by a connection
         pool exhaustion. The fix was increasing max connections from 5 to 20
         in src/config/database.ts and adding a connection timeout of 5000ms.
```

### Architecture Decisions

Record the why, not just the what:

```
/remember We use event sourcing for the order service because we need a complete
         audit trail for compliance. The event store is in DynamoDB with
         streams projecting to PostgreSQL for queries.
```

### Before a Long Break

Capture current state:

```
/remember Current state: halfway through migrating from Express to Hono.
         Completed: auth routes, user routes. Remaining: payment routes,
         webhook handlers. Key issue: the middleware signature is different,
         see src/middleware/MIGRATION.md for the pattern.
```
