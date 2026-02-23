import Surreal from "surrealdb";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

  constructor(config: SurrealDBConfig) {
    this.config = config;
    this.db = new Surreal();
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

      await this.db.use({
        namespace: this.config.namespace,
        database: this.config.database,
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

  async initSchema(): Promise<void> {
    for (const sql of ALL_SCHEMA_SQL) {
      await this.db.query(sql);
    }
  }

  async query<T = unknown>(surql: string, vars?: Record<string, unknown>): Promise<T[]> {
    if (!this.connected) {
      throw new Error("SurrealDB not connected");
    }
    const result = await this.db.query(surql, vars);
    // Flatten result arrays
    return result.flat() as T[];
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
  }

  async recallMemories(params: {
    query: string;
    scope?: string;
    memoryType?: string;
    limit?: number;
  }): Promise<unknown[]> {
    let surql = `SELECT *, search::score(1) AS relevance
      FROM memory
      WHERE content @1@ $query
        AND status = 'active'`;

    if (params.scope) {
      surql += ` AND scope = $scope`;
    }
    if (params.memoryType) {
      surql += ` AND memory_type = $memory_type`;
    }

    surql += ` ORDER BY relevance DESC LIMIT $limit`;

    const result = await this.db.query(surql, {
      query: params.query,
      scope: params.scope ?? null,
      memory_type: params.memoryType ?? null,
      limit: params.limit ?? 10,
    });

    // Strengthen accessed memories
    const memories = (result as any[]).flat();
    for (const mem of memories) {
      if (mem?.id) {
        await this.db.query(
          `UPDATE $id SET
            access_count += 1,
            last_accessed_at = time::now(),
            updated_at = time::now()`,
          { id: mem.id }
        );
      }
    }

    return memories;
  }

  async getStatus(): Promise<{
    connected: boolean;
    mode: string;
    memoryCount: number;
    entityCount: number;
  }> {
    if (!this.connected) {
      return { connected: false, mode: this.config.mode, memoryCount: 0, entityCount: 0 };
    }

    const [memResult] = await this.db.query("SELECT count() FROM memory GROUP ALL");
    const [entResult] = await this.db.query("SELECT count() FROM entity GROUP ALL");

    return {
      connected: true,
      mode: this.config.mode,
      memoryCount: (memResult as any)?.count ?? 0,
      entityCount: (entResult as any)?.count ?? 0,
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
