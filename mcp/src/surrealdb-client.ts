import Surreal from "surrealdb";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ALL_SCHEMA_SQL } from "./schema.js";

export type DeploymentMode = "embedded" | "local" | "remote" | "memory";

export interface SurrealDBConfig {
  mode: DeploymentMode;
  dataPath?: string;
  url?: string;
  username: string;
  password: string;
  namespace: string;
  database: string;
}

/**
 * Scope identifiers for hierarchical memory isolation.
 * - projectId: hash of project root path (unique per project)
 * - userId: hash of HOME path (unique per user/machine)
 * - sessionId: from CLAUDE_SESSION_ID env var (unique per session)
 */
export interface ScopeIdentifiers {
  projectId: string;
  userId: string;
  sessionId: string;
}

/**
 * Generate deterministic scope identifiers for memory isolation.
 * Called once on startup to establish the identity of this session.
 */
export function generateScopeIds(): ScopeIdentifiers {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const home = process.env.HOME ?? "/tmp";
  const sessionId = process.env.CLAUDE_SESSION_ID ?? `s_${Date.now()}`;

  return {
    projectId: `p_${createHash("sha256").update(projectRoot).digest("hex").slice(0, 12)}`,
    userId: `u_${createHash("sha256").update(home).digest("hex").slice(0, 12)}`,
    sessionId: sessionId.startsWith("s_") ? sessionId : `s_${sessionId.slice(0, 16)}`,
  };
}

/**
 * Read plugin config from .claude/surrealdb-memory.local.md YAML frontmatter.
 * Returns partial config — caller merges with defaults.
 */
export function readConfig(projectRoot?: string): Partial<SurrealDBConfig> {
  const roots = [
    projectRoot,
    process.env.CLAUDE_PROJECT_ROOT,
    process.cwd(),
  ].filter(Boolean) as string[];

  for (const root of roots) {
    const configPath = join(root, ".claude", "surrealdb-memory.local.md");
    if (!existsSync(configPath)) continue;

    try {
      const raw = readFileSync(configPath, "utf-8");
      // Parse YAML frontmatter between --- delimiters
      const match = raw.match(/^---\n([\s\S]*?)\n---/);
      if (!match) continue;

      const yaml = match[1];
      const config: Partial<SurrealDBConfig> = {};

      for (const line of yaml.split("\n")) {
        const [key, ...rest] = line.split(":");
        const value = rest.join(":").trim();
        if (!key || !value) continue;

        const k = key.trim();
        switch (k) {
          case "mode":
            if (["embedded", "local", "remote", "memory"].includes(value)) {
              config.mode = value as DeploymentMode;
            }
            break;
          case "url":
            config.url = value;
            break;
          case "data_path":
            config.dataPath = value;
            break;
          case "username":
            config.username = value;
            break;
          case "password":
            config.password = value;
            break;
          case "namespace":
            config.namespace = value;
            break;
          case "database":
            config.database = value;
            break;
        }
      }

      return config;
    } catch {
      // Config file unreadable — continue with defaults
    }
  }

  return {};
}

export class SurrealDBClient {
  private db: Surreal;
  private config: SurrealDBConfig;
  private connected = false;
  private scopeIds: ScopeIdentifiers;

  constructor(config: SurrealDBConfig, scopeIds?: ScopeIdentifiers) {
    this.config = config;
    this.db = new Surreal();
    this.scopeIds = scopeIds ?? generateScopeIds();
  }

  async connect(): Promise<void> {
    const endpoint = this.resolveEndpoint();

    try {
      await this.db.connect(endpoint);

      // Memory mode doesn't need auth in SurrealDB embedded
      if (this.config.mode !== "memory") {
        await this.db.signin({
          username: this.config.username,
          password: this.config.password,
        });
      }

      // Use the project-scoped database as default context
      await this.db.use({
        namespace: this.config.namespace,
        database: this.scopeIds.projectId,
      });

      this.connected = true;
    } catch (err) {
      console.error(`Failed to connect to SurrealDB (${this.config.mode}):`, err);
      throw err;
    }
  }

  private resolveEndpoint(): string {
    switch (this.config.mode) {
      case "embedded":
        // SurrealKV embedded — persistent, zero-config
        return `surrealkv://${this.config.dataPath ?? `${process.env.HOME}/.claude/surrealdb-memory/data`}`;
      case "local":
        // Local SurrealDB server via WebSocket
        return this.config.url ?? "ws://localhost:8000";
      case "remote":
        // Remote/cloud SurrealDB via secure WebSocket
        return this.config.url ?? "wss://cloud.surrealdb.com";
      case "memory":
        // In-memory mode — fast, ephemeral (data lost on close unless exported)
        return "mem://";
      default:
        return `surrealkv://${this.config.dataPath ?? `${process.env.HOME}/.claude/surrealdb-memory/data`}`;
    }
  }

  /**
   * Initialize schema across all three scope databases.
   * Each scope (session, project, user) gets its own SurrealDB database
   * with the same schema, enabling true isolation at the database level.
   */
  async initSchema(): Promise<void> {
    const ns = this.config.namespace;
    const databases = [
      { scope: "session", db: this.scopeIds.sessionId },
      { scope: "project", db: this.scopeIds.projectId },
      { scope: "user",    db: this.scopeIds.userId },
    ];

    for (const { db: dbName } of databases) {
      await this.db.use({ namespace: ns, database: dbName });
      for (const sql of ALL_SCHEMA_SQL) {
        await this.db.query(sql);
      }
    }

    // Return to project scope as default working context
    await this.db.use({ namespace: ns, database: this.scopeIds.projectId });
  }

  async query<T = unknown>(surql: string, vars?: Record<string, unknown>): Promise<T[]> {
    if (!this.connected) {
      throw new Error("SurrealDB not connected");
    }
    const result = await this.db.query(surql, vars);
    // Flatten result arrays
    return result.flat() as T[];
  }

  /**
   * Resolve which SurrealDB database to use for a given memory scope.
   */
  private scopeToDatabase(scope: string): string {
    switch (scope) {
      case "session": return this.scopeIds.sessionId;
      case "project": return this.scopeIds.projectId;
      case "user":    return this.scopeIds.userId;
      default:        return this.scopeIds.projectId;
    }
  }

  /**
   * Switch to the database for a given scope, execute a callback, then switch back.
   */
  private async withScope<T>(scope: string, fn: () => Promise<T>): Promise<T> {
    const targetDb = this.scopeToDatabase(scope);
    const currentDb = this.scopeIds.projectId; // default context
    const needsSwitch = targetDb !== currentDb;

    if (needsSwitch) {
      await this.db.use({ namespace: this.config.namespace, database: targetDb });
    }

    try {
      return await fn();
    } finally {
      if (needsSwitch) {
        await this.db.use({ namespace: this.config.namespace, database: currentDb });
      }
    }
  }

  async storeMemory(params: {
    content: string;
    memoryType: string;
    scope: string;
    tags?: string[];
    embedding?: number[];
    importance?: number;
    metadata?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.withScope(params.scope, async () => {
      const [result] = await this.db.query(
        `CREATE memory SET
          content = $content,
          memory_type = $memory_type,
          scope = $scope,
          tags = $tags,
          embedding = $embedding,
          importance = $importance,
          metadata = $metadata,
          created_at = time::now(),
          updated_at = time::now(),
          last_accessed_at = time::now()
        `,
        {
          content: params.content,
          memory_type: params.memoryType,
          scope: params.scope,
          tags: params.tags ?? [],
          embedding: params.embedding ?? null,
          importance: params.importance ?? 0.5,
          metadata: params.metadata ?? null,
        }
      );
      return result;
    });
  }

  /**
   * Recall memories across scopes. If no scope specified, searches all three
   * databases (session, project, user) and merges results with scope weighting.
   * Session memories ranked highest (most relevant), then project, then user.
   */
  async recallMemories(params: {
    query: string;
    scope?: string;
    memoryType?: string;
    limit?: number;
  }): Promise<unknown[]> {
    const buildQuery = () => {
      let surql = `SELECT *, search::score(1) AS relevance
        FROM memory
        WHERE content @1@ $query
          AND status = 'active'`;

      if (params.memoryType) {
        surql += ` AND memory_type = $memory_type`;
      }

      surql += ` ORDER BY relevance DESC LIMIT $limit`;
      return surql;
    };

    const vars = {
      query: params.query,
      memory_type: params.memoryType ?? null,
      limit: params.limit ?? 10,
    };

    let allMemories: any[] = [];

    if (params.scope) {
      // Search single scope
      allMemories = await this.withScope(params.scope, async () => {
        const result = await this.db.query(buildQuery(), vars);
        return (result as any[]).flat().map((m: any) => ({ ...m, _scope: params.scope }));
      });
    } else {
      // Search all three scopes and merge with priority weighting
      const scopeWeights = { session: 1.5, project: 1.0, user: 0.7 };

      for (const [scope, weight] of Object.entries(scopeWeights)) {
        try {
          const scopeResults = await this.withScope(scope, async () => {
            const result = await this.db.query(buildQuery(), vars);
            return (result as any[]).flat().map((m: any) => ({
              ...m,
              _scope: scope,
              _weighted_relevance: (m.relevance ?? 0) * weight,
            }));
          });
          allMemories.push(...scopeResults);
        } catch {
          // Scope database might not exist yet — skip silently
        }
      }

      // Sort by weighted relevance and trim to limit
      allMemories.sort((a, b) => (b._weighted_relevance ?? 0) - (a._weighted_relevance ?? 0));
      allMemories = allMemories.slice(0, params.limit ?? 10);
    }

    // Strengthen accessed memories (in their respective scope databases)
    for (const mem of allMemories) {
      if (mem?.id && mem._scope) {
        try {
          await this.withScope(mem._scope, async () => {
            await this.db.query(
              `UPDATE $id SET
                access_count += 1,
                last_accessed_at = time::now(),
                updated_at = time::now()`,
              { id: mem.id }
            );
          });
        } catch {
          // Non-critical — strengthening failure shouldn't break recall
        }
      }
    }

    return allMemories;
  }

  async getStatus(): Promise<{
    connected: boolean;
    mode: string;
    scopeIds: ScopeIdentifiers;
    scopes: Record<string, { memoryCount: number; entityCount: number }>;
    totalMemories: number;
    totalEntities: number;
  }> {
    if (!this.connected) {
      return {
        connected: false,
        mode: this.config.mode,
        scopeIds: this.scopeIds,
        scopes: {},
        totalMemories: 0,
        totalEntities: 0,
      };
    }

    const scopes: Record<string, { memoryCount: number; entityCount: number }> = {};
    let totalMemories = 0;
    let totalEntities = 0;

    for (const scope of ["session", "project", "user"] as const) {
      try {
        const counts = await this.withScope(scope, async () => {
          const [memResult] = await this.db.query("SELECT count() FROM memory GROUP ALL");
          const [entResult] = await this.db.query("SELECT count() FROM entity GROUP ALL");
          return {
            memoryCount: (memResult as any)?.count ?? 0,
            entityCount: (entResult as any)?.count ?? 0,
          };
        });
        scopes[scope] = counts;
        totalMemories += counts.memoryCount;
        totalEntities += counts.entityCount;
      } catch {
        scopes[scope] = { memoryCount: 0, entityCount: 0 };
      }
    }

    return {
      connected: true,
      mode: this.config.mode,
      scopeIds: this.scopeIds,
      scopes,
      totalMemories,
      totalEntities,
    };
  }

  /**
   * Close the database connection.
   * If mode is "memory", exports all data as JSON to the data path for snapshot persistence.
   */
  async close(): Promise<void> {
    if (this.connected && this.config.mode === "memory") {
      await this.exportMemorySnapshot();
    }
    await this.db.close();
    this.connected = false;
  }

  /**
   * Export all memory data as a JSON snapshot (used by memory mode for persistence).
   * Writes to {dataPath}/snapshot.json.
   */
  private async exportMemorySnapshot(): Promise<void> {
    try {
      const dataPath = this.config.dataPath ?? `${process.env.HOME}/.claude/surrealdb-memory/data`;
      const { mkdirSync, writeFileSync } = await import("node:fs");

      mkdirSync(dataPath, { recursive: true });

      const [memories] = await this.db.query("SELECT * FROM memory WHERE status != 'forgotten'");
      const [entities] = await this.db.query("SELECT * FROM entity");
      const [relations] = await this.db.query("SELECT * FROM relates_to");

      const snapshot = {
        exported_at: new Date().toISOString(),
        mode: this.config.mode,
        memories,
        entities,
        relations,
      };

      writeFileSync(
        join(dataPath, "snapshot.json"),
        JSON.stringify(snapshot, null, 2),
        "utf-8"
      );
    } catch (err) {
      console.error("Failed to export memory snapshot:", err);
    }
  }

  /** Get the raw Surreal instance for advanced queries */
  get raw(): Surreal {
    return this.db;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get currentMode(): DeploymentMode {
    return this.config.mode;
  }
}
