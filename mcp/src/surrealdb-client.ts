import Surreal from "surrealdb";

export interface SurrealDBConfig {
  mode: "embedded" | "local" | "remote";
  dataPath?: string;
  url?: string;
  username: string;
  password: string;
  namespace: string;
  database: string;
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
      await this.db.signin({
        username: this.config.username,
        password: this.config.password,
      });
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
        return `surrealkv://${this.config.dataPath}`;
      case "local":
        return this.config.url ?? "ws://localhost:8000";
      case "remote":
        return this.config.url ?? "wss://cloud.surrealdb.com";
      default:
        return `surrealkv://${this.config.dataPath}`;
    }
  }

  async initSchema(): Promise<void> {
    // Core memory table
    await this.db.query(`
      DEFINE TABLE IF NOT EXISTS memory SCHEMAFULL;

      DEFINE FIELD IF NOT EXISTS content ON memory TYPE string;
      DEFINE FIELD IF NOT EXISTS memory_type ON memory TYPE string
        ASSERT $value IN ['episodic', 'semantic', 'procedural', 'working'];
      DEFINE FIELD IF NOT EXISTS scope ON memory TYPE string
        ASSERT $value IN ['session', 'project', 'user'];
      DEFINE FIELD IF NOT EXISTS tags ON memory TYPE array<string> DEFAULT [];
      DEFINE FIELD IF NOT EXISTS embedding ON memory TYPE option<array<float>>;
      DEFINE FIELD IF NOT EXISTS importance ON memory TYPE float DEFAULT 0.5;
      DEFINE FIELD IF NOT EXISTS confidence ON memory TYPE float DEFAULT 0.7;
      DEFINE FIELD IF NOT EXISTS access_count ON memory TYPE int DEFAULT 0;
      DEFINE FIELD IF NOT EXISTS status ON memory TYPE string DEFAULT 'active'
        ASSERT $value IN ['active', 'consolidated', 'archived', 'forgotten'];
      DEFINE FIELD IF NOT EXISTS created_at ON memory TYPE datetime DEFAULT time::now();
      DEFINE FIELD IF NOT EXISTS updated_at ON memory TYPE datetime DEFAULT time::now();
      DEFINE FIELD IF NOT EXISTS last_accessed_at ON memory TYPE datetime DEFAULT time::now();
      DEFINE FIELD IF NOT EXISTS metadata ON memory FLEXIBLE TYPE option<object>;

      DEFINE INDEX IF NOT EXISTS memory_scope ON memory FIELDS scope;
      DEFINE INDEX IF NOT EXISTS memory_type_idx ON memory FIELDS memory_type;
      DEFINE INDEX IF NOT EXISTS memory_status ON memory FIELDS status;
    `);

    // Entity table for knowledge graph
    await this.db.query(`
      DEFINE TABLE IF NOT EXISTS entity SCHEMAFULL;

      DEFINE FIELD IF NOT EXISTS name ON entity TYPE string;
      DEFINE FIELD IF NOT EXISTS entity_type ON entity TYPE string;
      DEFINE FIELD IF NOT EXISTS description ON entity TYPE string DEFAULT '';
      DEFINE FIELD IF NOT EXISTS embedding ON entity TYPE option<array<float>>;
      DEFINE FIELD IF NOT EXISTS mention_count ON entity TYPE int DEFAULT 1;
      DEFINE FIELD IF NOT EXISTS confidence ON entity TYPE float DEFAULT 0.7;
      DEFINE FIELD IF NOT EXISTS scope ON entity TYPE string;
      DEFINE FIELD IF NOT EXISTS created_at ON entity TYPE datetime DEFAULT time::now();
      DEFINE FIELD IF NOT EXISTS updated_at ON entity TYPE datetime DEFAULT time::now();

      DEFINE INDEX IF NOT EXISTS entity_name ON entity FIELDS name;
      DEFINE INDEX IF NOT EXISTS entity_type_idx ON entity FIELDS entity_type;
    `);

    // Relationship edge table
    await this.db.query(`
      DEFINE TABLE IF NOT EXISTS relates_to TYPE RELATION FROM entity TO entity SCHEMAFULL;

      DEFINE FIELD IF NOT EXISTS relation_type ON relates_to TYPE string;
      DEFINE FIELD IF NOT EXISTS weight ON relates_to TYPE float DEFAULT 0.5;
      DEFINE FIELD IF NOT EXISTS confidence ON relates_to TYPE float DEFAULT 0.7;
      DEFINE FIELD IF NOT EXISTS scope ON relates_to TYPE string;
      DEFINE FIELD IF NOT EXISTS created_at ON relates_to TYPE datetime DEFAULT time::now();
    `);

    // Full-text search analyzer
    await this.db.query(`
      DEFINE ANALYZER IF NOT EXISTS memory_analyzer TOKENIZERS blank, class
        FILTERS ascii, lowercase, snowball(english);

      DEFINE INDEX IF NOT EXISTS memory_content_search ON memory
        FIELDS content SEARCH ANALYZER memory_analyzer BM25;
    `);
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

  async close(): Promise<void> {
    await this.db.close();
    this.connected = false;
  }
}
