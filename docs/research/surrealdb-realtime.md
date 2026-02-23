# Real-Time Live Queries and Changefeeds

> SurrealDB provides first-class real-time capabilities through three complementary mechanisms: **LIVE SELECT** queries for push-based notifications, **Changefeeds** for historical change replay, and **DEFINE EVENT** triggers for server-side automation. Combined with native WebSocket support and multi-format RPC, these features eliminate the need for external message brokers or polling in many real-time application architectures.

---

## Table of Contents

- [[#LIVE SELECT -- Push-Based Real-Time Queries]]
  - [[#Basic Syntax]]
  - [[#Filtering with WHERE]]
  - [[#DIFF Mode -- JSON Patch Notifications]]
  - [[#FETCH -- Following Record Links]]
  - [[#Listening to Specific Records and Ranges]]
  - [[#Killing Live Queries]]
  - [[#Notification Actions]]
  - [[#Current Limitations]]
- [[#Changefeeds -- Historical Change Data Capture]]
  - [[#Defining a Changefeed]]
  - [[#Querying Changes with SHOW CHANGES FOR]]
  - [[#INCLUDE ORIGINAL]]
  - [[#Versionstamps]]
  - [[#Changefeed Internals]]
  - [[#Live Queries vs Changefeeds]]
- [[#DEFINE EVENT -- Server-Side Triggers]]
  - [[#Event Syntax]]
  - [[#Special Variables]]
  - [[#Synchronous vs Asynchronous Events]]
  - [[#Event Patterns]]
- [[#WebSocket RPC Protocol]]
  - [[#Connection and Message Format]]
  - [[#Available RPC Methods]]
  - [[#Live Query Notifications Over WebSocket]]
  - [[#Data Formats -- JSON and CBOR]]
  - [[#Authentication Over WebSocket]]
- [[#SDK Integration]]
  - [[#JavaScript / TypeScript SDK]]
  - [[#Rust SDK]]
  - [[#Python SDK]]
- [[#Architecture Patterns]]
  - [[#Get and Subscribe Pattern]]
  - [[#Real-Time Dashboard]]
  - [[#Collaborative Editing]]
  - [[#Event Sourcing with Changefeeds]]
  - [[#Real-Time Presence Tracking]]
  - [[#IoT Telemetry Pipeline]]
  - [[#Real-Time AI Pipeline]]
- [[#Best Practices]]
- [[#Key Takeaways]]

---

## LIVE SELECT -- Push-Based Real-Time Queries

`LIVE SELECT` creates a persistent subscription that captures any subsequent changes to the data in real time. When a matching record is created, updated, or deleted, SurrealDB immediately pushes a notification to the subscribed client over their WebSocket connection.

> **Important (as of SurrealDB 3.0):** `LIVE SELECT` is currently only supported in **single-node deployments**. Multi-node support is actively being developed.

### Basic Syntax

```surql
LIVE SELECT <fields> FROM <table> [WHERE <condition>] [FETCH <fields>];
```

The statement returns a **UUID** that identifies the live query session. This UUID is used to differentiate notifications and to kill the query later.

```surql
LIVE SELECT * FROM person;
-- Returns: u'b87cbb0d-ca15-4f0a-8f86-caa680672aa5'
```

### Filtering with WHERE

Apply filters to receive notifications only for records matching specific conditions:

```surql
-- Only get notified about critical weather events in London
LIVE SELECT * FROM weather WHERE location = "London" AND severity = "critical";

-- Only receive updates for the authenticated user's documents
LIVE SELECT * FROM document WHERE account = $auth.account OR public = true;

-- Track high-value orders only
LIVE SELECT * FROM order WHERE total > 100.00;
```

Notifications fire only when a record **satisfies the WHERE condition** at the time of the change.

### DIFF Mode -- JSON Patch Notifications

Instead of receiving the full record on every change, `DIFF` mode sends [JSON Patch](https://jsonpatch.com/) (RFC 6902) operations describing what changed. This is ideal for bandwidth-sensitive applications and efficient client-side state synchronization.

```surql
LIVE SELECT DIFF FROM person;
-- Returns: u'...'
```

Example notification stream when using DIFF mode:

```json
// CREATE: Full record delivered as a replace operation
{
  "action": "CREATE",
  "result": [
    { "op": "replace", "path": "/", "value": { "id": "test:hugh", "name": "hugh" } }
  ]
}

// UPDATE: Only the changed fields
{
  "action": "UPDATE",
  "result": [
    { "op": "add", "path": "/language", "value": "golang" }
  ]
}

// UPDATE: String-level diff using diff-match-patch
{
  "action": "UPDATE",
  "result": [
    { "op": "change", "path": "/language", "value": "@@ -1,6 +1,4 @@\n-golang\n+rust\n" }
  ]
}

// UPDATE: Field removal
{
  "action": "UPDATE",
  "result": [
    { "op": "remove", "path": "/language" }
  ]
}

// DELETE: Returns the record ID
{
  "action": "DELETE",
  "result": "test:hugh"
}
```

### FETCH -- Following Record Links

The `FETCH` clause automatically resolves linked records in notifications, so the client receives denormalized data:

```surql
-- Fetch the author's full record in every notification
LIVE SELECT * FROM post FETCH author;

-- Fetch multiple linked fields
LIVE SELECT * FROM order FETCH customer, items;
```

### Listening to Specific Records and Ranges

```surql
-- Listen to changes on a single record
LIVE SELECT * FROM post:c569rth77ad48tc6s3ig;

-- Listen to a range of records (internally converted to WHERE clause)
LIVE SELECT * FROM account:a..=account:g;
```

> **Note:** Live queries on record ID ranges are internally transformed to use a `WHERE` clause on the table, as `LIVE` does not directly support record IDs in the `FROM` clause.

### Killing Live Queries

Stop receiving notifications by killing the live query with its UUID:

```surql
KILL "b87cbb0d-ca15-4f0a-8f86-caa680672aa5";
```

When killed, a final `KILLED` notification is sent to the client to confirm termination.

**Always clean up live queries** when they are no longer needed. Failing to kill them causes memory leaks on both server and client.

### Notification Actions

Every live query notification includes an `action` field:

| Action     | Trigger                                          |
| ---------- | ------------------------------------------------ |
| `CREATE`   | A new record matching the query is inserted      |
| `UPDATE`   | An existing matching record is modified           |
| `DELETE`   | A matching record is removed                      |
| `KILLED`   | The live query itself was terminated via `KILL`   |

### Current Limitations

- **Single-node only** -- multi-node (distributed) live queries are in development
- Not supported on `Resource::Object` or `Resource::Array` types
- A `MAX_NOTIFICATIONS` limit exists to prevent notification accumulation
- Certain storage engines or protocol configurations may not support live queries
- Live queries require a persistent connection (WebSocket or embedded)

---

## Changefeeds -- Historical Change Data Capture

Changefeeds implement the **Change Data Capture (CDC)** pattern. Unlike live queries that push events in real time, changefeeds record changes persistently and allow them to be **replayed** at any time within the retention window.

### Defining a Changefeed

Enable a changefeed on a table by specifying a retention duration:

```surql
-- Keep changes for 1 day
DEFINE TABLE reading CHANGEFEED 1d;

-- Keep changes for 1 hour with original state
DEFINE TABLE user CHANGEFEED 1h INCLUDE ORIGINAL;

-- Keep changes for 7 days
DEFINE TABLE order CHANGEFEED 7d;
```

Once defined, SurrealDB records every CREATE, UPDATE, and DELETE operation on that table. Behind the scenes, SurrealDB also defines a database-level changefeed to coordinate cross-table ordering.

### Querying Changes with SHOW CHANGES FOR

Retrieve historical changes since a given timestamp or versionstamp:

```surql
-- By datetime (must be after the changefeed was defined)
SHOW CHANGES FOR TABLE reading SINCE d"2024-07-20T10:00:00Z" LIMIT 10;

-- By versionstamp (integer)
SHOW CHANGES FOR TABLE reading SINCE 1 LIMIT 10;

-- Database-level changes (all tables)
SHOW CHANGES FOR DATABASE SINCE d"2024-07-20T10:00:00Z" LIMIT 100;
```

**Limits:** Default is 100 results, maximum is 1000.

Example response:

```json
[
  {
    "changes": [
      { "define_table": { "name": "reading" } }
    ],
    "versionstamp": 65536
  },
  {
    "changes": [
      { "update": { "id": "reading:bavjgpnhkgvudfg4mg16", "story": "Once upon a time" } }
    ],
    "versionstamp": 131072
  },
  {
    "changes": [
      { "update": { "id": "reading:liq4e7hzjaw7bp5t4pn1", "story": "there was a database" } }
    ],
    "versionstamp": 196608
  }
]
```

### INCLUDE ORIGINAL

When defined with `INCLUDE ORIGINAL`, the changefeed stores the record state **before** the modification alongside the new state. This is essential for auditing and diff computation:

```surql
DEFINE TABLE user CHANGEFEED 1h INCLUDE ORIGINAL;

-- After an update, SHOW CHANGES will include both before and after states
```

### Versionstamps

Each change set carries a **versionstamp** (a `u64` integer) that provides ordering guarantees:

- Versionstamps are **monotonically increasing** within a single table
- Cross-table ordering may not be sequential (the database-level changefeed interleaves all tables)
- For the FoundationDB backend, versionstamps include two extra bytes for detailed ordering; use right shift (`>> 16`) to normalize
- A `SINCE` value greater than the current versionstamp returns an empty array
- `SINCE` datetime must be after the changefeed was defined

### Changefeed Internals

1. **Buffering:** When a record is modified, `changefeed_buffer_record_change` buffers the change
2. **Writing:** Before transaction commit, `store_changes` writes buffered changes with the current timestamp
3. **Storage keys:** Constructed from `[namespace, database, timestamp, table]`
4. **Garbage collection:** A background task (`changefeed_process`) periodically cleans expired entries using the configured `expiry` duration
5. **Lease-based cleanup:** Only one node performs cleanup at a time (via lease acquisition)

### Live Queries vs Changefeeds

| Feature              | LIVE SELECT                        | Changefeeds                           |
| -------------------- | ---------------------------------- | ------------------------------------- |
| **Delivery**         | Push (real-time via WebSocket)     | Pull (query with SHOW CHANGES)        |
| **Persistence**      | Ephemeral (connection-scoped)      | Persistent (stored on disk)           |
| **History**          | No replay                          | Full replay within retention window   |
| **Latency**          | Immediate                          | On-demand (query when needed)         |
| **Connection**       | Requires persistent connection     | Works with any connection type        |
| **Filtering**        | WHERE clause at subscription time  | Filter after retrieval                |
| **Use case**         | Real-time UI updates, dashboards   | CDC, sync to external systems, audit  |
| **Include original** | No                                 | Yes (with INCLUDE ORIGINAL)           |
| **Multi-node**       | Single-node only (currently)       | Supported                             |

**Key insight:** Use live queries for real-time client notifications. Use changefeeds for reliable, replayable integration with external systems.

---

## DEFINE EVENT -- Server-Side Triggers

Events are database-side triggers that fire automatically when records in a table are created, updated, or deleted. They execute SurrealQL statements in response to data changes.

### Event Syntax

```surql
DEFINE EVENT [ IF NOT EXISTS | OVERWRITE ] @name
  ON [ TABLE ] @table
  [ ASYNC [ RETRY @retry ] [ MAXDEPTH @max_depth ] ]
  [ WHEN @condition ]
  THEN @action
  [ COMMENT @string ];
```

### Special Variables

Events provide context through special variables available in `WHEN` and `THEN` clauses:

| Variable  | Description                                                    |
| --------- | -------------------------------------------------------------- |
| `$event`  | The operation type: `"CREATE"`, `"UPDATE"`, or `"DELETE"`      |
| `$before` | Record state before the modification                           |
| `$after`  | Record state after the modification                            |
| `$value`  | Current record (`$after` for CREATE/UPDATE, `$before` for DELETE) |
| `$this`   | Alias for the current record                                   |
| `$input`  | The input data provided by the caller                          |

### Synchronous vs Asynchronous Events

**Synchronous events** (default) run within the same transaction as the triggering operation. If the event fails, the entire transaction rolls back:

```surql
-- Synchronous: rolls back the CREATE if the event fails
DEFINE EVENT audit ON TABLE user WHEN $event = "UPDATE" THEN (
    CREATE audit_log SET
        table = "user",
        record = $value.id,
        action = $event,
        before = $before,
        after = $after,
        at = time::now()
);
```

**Asynchronous events** (SurrealDB 3.0+) are enqueued within the transaction but execute in a separate background transaction. The `ASYNC` keyword, `RETRY` count, and `MAXDEPTH` limit are available:

```surql
-- Async: enqueued but runs in background
DEFINE EVENT notify_webhook ON TABLE order ASYNC RETRY 3 MAXDEPTH 2
    WHEN $event = "CREATE"
    THEN {
        http::post('https://hooks.example.com/new-order', {
            body: {
                order_id: $after.id,
                total: $after.total,
                customer: $after.customer
            }
        });
    };
```

**Properties of async events:**
- **Atomicity:** Enqueued within the same transaction as the document change (if the transaction fails, the event is never queued)
- **Consistency:** Executed in a separate transaction, seeing database state at execution time
- **Retry:** Failed events are retried up to the configured count
- **MAXDEPTH:** Prevents infinite recursive event chains

### Event Patterns

#### Audit Logging

```surql
DEFINE EVENT email_change ON TABLE user
    WHEN $before.email != $after.email
    THEN (
        CREATE event SET
            user = $value.id,
            time = time::now(),
            value = $after.email,
            action = 'email_changed'
    );
```

#### Cascading Updates

```surql
DEFINE EVENT update_citizens ON TABLE person
    WHEN $before.city != $after.city
    THEN {
        IF $before.city {
            UPSERT $before.city SET citizens -= $value.id;
        };
        IF $after.city {
            UPSERT $after.city SET citizens += $value.id;
        };
    };
```

#### HTTP Webhook Triggers

```surql
-- Requires: surreal start --allow-net example.com
DEFINE EVENT alert ON TABLE weather
    WHEN severity = "critical"
    THEN {
        LET $alert = CREATE ONLY alert SET
            at = time::now(),
            body = "Alert! " + $input.conditions + " in " + $input.location
            RETURN VALUE body;
        http::post('https://hooks.example.com/alerts', { body: $alert });
    };
```

#### Cleanup on Delete

```surql
DEFINE EVENT removal ON user WHEN $event = 'DELETE' THEN {
    DELETE sticky WHERE author = $before.id;
    DELETE tag WHERE owner = $before.id;
};
```

#### Conditional Event Triggering

```surql
DEFINE EVENT something ON person
    WHEN $input.log_event = true
    THEN {
        CREATE log SET at = time::now(), of = $input;
    };

-- Does NOT trigger the event (log_event = false)
CREATE person:debug SET name = "Billy", log_event = false;

-- Triggers the event
CREATE person:real SET name = "Bobby", log_event = true;
```

> **Warning:** Avoid event chains where one event triggers another that triggers the first. This creates infinite loops. Use `MAXDEPTH` on async events to bound recursion.

---

## WebSocket RPC Protocol

SurrealDB exposes a WebSocket-based RPC protocol for bi-directional, real-time communication. This is the primary transport for live query notifications.

### Connection and Message Format

**Connect to:**
```
ws://localhost:8000/rpc    (unencrypted)
wss://localhost:8000/rpc   (TLS)
```

**Request format:**
```json
{
    "id": 1,
    "method": "query",
    "params": ["SELECT * FROM person"]
}
```

**Response format:**
```json
{
    "id": 1,
    "result": [
        {
            "status": "OK",
            "time": "152.883us",
            "result": [...]
        }
    ]
}
```

The `id` field correlates requests with responses. Live query notifications are **unsolicited messages** (no `id` field) pushed by the server.

### Available RPC Methods

#### Connection Management

| Method      | Parameters                | Description                                    |
| ----------- | ------------------------- | ---------------------------------------------- |
| `use`       | `[namespace, database]`   | Set namespace and database for the session     |
| `ping`      | none                      | Heartbeat / keep-alive                         |
| `version`   | none                      | Get server version info                        |
| `reset`     | none                      | Clear session state, abort live queries        |

#### Authentication

| Method         | Parameters         | Description                          |
| -------------- | ------------------ | ------------------------------------ |
| `signin`       | `[credentials]`    | Authenticate (root/NS/DB/record)     |
| `signup`       | `[credentials]`    | Register a record user               |
| `authenticate` | `[token]`          | Auth with existing JWT token         |
| `invalidate`   | none               | End authenticated session            |
| `info`         | none               | Get current user record              |

#### Session Variables (WebSocket only)

| Method  | Parameters       | Description                              |
| ------- | ---------------- | ---------------------------------------- |
| `let`   | `[name, value]`  | Define a variable for the session        |
| `unset` | `[name]`         | Remove a session variable                |

#### Data Operations

| Method            | Parameters                     | Description                       |
| ----------------- | ------------------------------ | --------------------------------- |
| `select`          | `[thing]`                      | Retrieve records                  |
| `create`          | `[thing, data]`                | Insert with random or specific ID |
| `insert`          | `[thing, data]`                | Insert (supports bulk arrays)     |
| `insert_relation` | `[table, data]`                | Create graph relation             |
| `update`          | `[thing, data]`                | Replace existing records          |
| `upsert`          | `[thing, data]`                | Create or replace                 |
| `merge`           | `[thing, data]`                | Merge into existing records       |
| `patch`           | `[thing, patches, diff]`       | Apply JSON Patch operations       |
| `relate`          | `[in, relation, out, data?]`   | Create graph edge                 |
| `delete`          | `[thing]`                      | Remove records                    |
| `query`           | `[sql, vars]`                  | Execute SurrealQL                 |
| `run`             | `[func, version?, args?]`      | Execute functions / ML models     |

#### Live Query Methods

| Method | Parameters        | Description                                      |
| ------ | ----------------- | ------------------------------------------------ |
| `live` | `[table, diff?]`  | Start live query, returns UUID                   |
| `kill` | `[queryUuid]`     | Stop a live query                                |

### Live Query Notifications Over WebSocket

Live query notifications are **pushed without an `id` field** -- they are unsolicited server messages:

```json
{
    "result": {
        "action": "CREATE",
        "id": "b87cbb0d-ca15-4f0a-8f86-caa680672aa5",
        "result": {
            "id": "person:john",
            "name": "John",
            "age": 30
        }
    }
}
```

When using diff mode (`live` with `diff: true`), the `result` field contains JSON Patch operations instead of the full record.

### Data Formats -- JSON and CBOR

SurrealDB supports two wire formats:

**JSON** (default): Text-based, human-readable. Complex types (UUID, Datetime, Geometry) are encoded as strings.

**CBOR** (binary): More compact, uses custom tags for SurrealDB types:

| Tag | Type                | Format                              |
| --- | ------------------- | ----------------------------------- |
| 6   | NONE                | null payload                        |
| 7   | Table name          | string                              |
| 8   | Record ID           | `[table, id]` array                 |
| 10  | Decimal             | string                              |
| 12  | Datetime            | `[seconds, nanoseconds]` array      |
| 14  | Duration            | `[seconds, nanoseconds]` array      |
| 37  | UUID                | binary format                       |
| 49  | Range               | with optional bounds                |
| 88  | Point               | `[longitude, latitude]`             |
| 89  | LineString          | array of 2+ points                  |
| 90  | Polygon             | array of closed lines               |
| 91-94 | Multi-geometries  | arrays of sub-geometries            |

CBOR is recommended for production deployments where bandwidth efficiency matters.

### Authentication Over WebSocket

```json
// Root user authentication
{
    "id": 1,
    "method": "signin",
    "params": [{
        "user": "root",
        "pass": "secret"
    }]
}

// Record user authentication (returns JWT)
{
    "id": 2,
    "method": "signin",
    "params": [{
        "NS": "myns",
        "DB": "mydb",
        "AC": "user_access",
        "email": "user@example.com",
        "password": "pass123"
    }]
}

// Token-based authentication
{
    "id": 3,
    "method": "authenticate",
    "params": ["eyJhbGciOiJIUzI1NiIs..."]
}
```

---

## SDK Integration

### JavaScript / TypeScript SDK

The JavaScript SDK provides three methods for live queries:

```typescript
// Method 1: db.live() with inline callback
const queryUuid = await db.live(
    "person",
    (action, result) => {
        // action: 'CREATE' | 'UPDATE' | 'DELETE' | 'CLOSE'
        if (action === 'CLOSE') return;
        console.log(`${action}:`, result);
    }
);

// With DIFF mode
const queryUuid = await db.live(
    "person",
    (action, result) => {
        // result is an array of JSON Patch operations
        console.log(`${action}:`, result);
    },
    true // diff mode
);

// Method 2: LIVE SELECT via query(), then subscribeLive()
const [uuid] = await db.query<[string]>('LIVE SELECT * FROM person WHERE age > 18');
await db.subscribeLive(uuid, (action, result) => {
    console.log(`${action}:`, result);
});

// Kill the live query when done
await db.kill(queryUuid);
```

**React integration with cleanup:**

```typescript
import { useEffect, useRef } from 'react';

function usePersonUpdates(onUpdate: (action: string, data: any) => void) {
    const uuidRef = useRef<string | null>(null);

    useEffect(() => {
        const setup = async () => {
            uuidRef.current = await db.live('person', onUpdate);
        };

        const cleanup = async () => {
            if (uuidRef.current) {
                await db.kill(uuidRef.current);
            }
        };

        // Kill on beforeunload to prevent memory leaks
        const handleBeforeUnload = () => cleanup();
        window.addEventListener('beforeunload', handleBeforeUnload);

        setup();

        return () => {
            cleanup();
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, []);
}
```

**SDK events emitter:**

```typescript
// The SDK emitter fires live-{uuid} events for each notification
db.emitter.subscribe(`live-${queryUuid}`, (notification) => {
    // notification.action: "CREATE" | "UPDATE" | "DELETE"
    // notification.result: the record or patch data
});
```

### Rust SDK

The Rust SDK returns an async `Stream` of notifications:

```rust
use futures::StreamExt;
use serde::Deserialize;
use surrealdb::engine::remote::ws::Ws;
use surrealdb::opt::auth::Root;
use surrealdb::{Notification, RecordId, Surreal};

#[derive(Debug, Deserialize)]
struct Person {
    id: RecordId,
    name: String,
    age: u32,
}

#[tokio::main]
async fn main() -> surrealdb::Result<()> {
    let db = Surreal::new::<Ws>("localhost:8000").await?;

    db.signin(Root {
        username: "root",
        password: "secret",
    })
    .await?;

    db.use_ns("namespace").use_db("database").await?;

    // Live query on entire table
    let mut stream = db.select("person").live().await?;

    while let Some(result) = stream.next().await {
        match result {
            Ok(notification) => {
                let action = notification.action;   // Action enum
                let person: Person = notification.data;  // Deserialized data
                let query_id = notification.query_id;    // Live query UUID
                println!("{action:?}: {person:?}");
            }
            Err(e) => eprintln!("Error: {e}"),
        }
    }

    Ok(())
}
```

**Listening to a single record:**

```rust
let mut stream = db
    .select(("person", "john"))
    .live()
    .await?;

while let Some(notification) = stream.next().await {
    println!("{notification:?}");
}
```

**Listening to a range:**

```rust
let mut stream = db
    .select("account")
    .range("a"..="g")
    .live()
    .await?;

while let Some(result) = stream.next().await {
    match result {
        Ok(notification) => {
            let action = notification.action;
            let account: Account = notification.data;
            println!("{action:?}: {account:?}");
        }
        Err(e) => eprintln!("Error: {e}"),
    }
}
```

### Python SDK

```python
import asyncio
from surrealdb import Surreal

async def main():
    db = Surreal("ws://localhost:8000/rpc")
    await db.connect()
    await db.signin({"user": "root", "pass": "secret"})
    await db.use("namespace", "database")

    # Start a live query
    query_uuid = await db.live("person")

    # Subscribe to notifications
    await db.subscribe_live(query_uuid, lambda notification:
        print(f"Action: {notification['action']}, Data: {notification['result']}")
    )

    # With DIFF mode
    diff_uuid = await db.live("person", diff=True)

    # Kill when done
    await db.kill(query_uuid)

asyncio.run(main())
```

---

## Architecture Patterns

### Get and Subscribe Pattern

The most common pattern: fetch an initial snapshot, then apply real-time updates:

```surql
-- Step 1: Start the live query FIRST (so no updates are missed)
LIVE SELECT * FROM chat_message WHERE room = $room_id;

-- Step 2: Fetch the current snapshot
SELECT * FROM chat_message WHERE room = $room_id ORDER BY created_at DESC LIMIT 50;
```

> **Order matters:** Start the live query first, then fetch the snapshot. This ensures no changes are missed between the snapshot and the subscription.

Client-side pseudo-code:

```javascript
// 1. Start live subscription
const uuid = await db.live('chat_message', (action, result) => {
    switch (action) {
        case 'CREATE': addMessage(result); break;
        case 'UPDATE': updateMessage(result); break;
        case 'DELETE': removeMessage(result); break;
    }
});

// 2. Fetch initial data
const messages = await db.query(
    'SELECT * FROM chat_message WHERE room = $room ORDER BY created_at DESC LIMIT 50',
    { room: roomId }
);
setMessages(messages);
```

### Real-Time Dashboard

Combine **table views**, **drop tables**, and **live queries** for efficient aggregation and real-time visualization:

```surql
-- High-frequency raw data table (data is dropped after processing)
DEFINE TABLE sensor_readings DROP;

-- Aggregated view (auto-updated by SurrealDB)
DEFINE TABLE daily_measurements AS
    SELECT
        id AS location,
        time::day(id) AS day,
        math::mean(temperature_celsius) AS avg_temperature,
        math::mean(humidity) AS avg_humidity
    FROM sensor_readings
    GROUP BY id;

-- Live query on the aggregated view for the dashboard
LIVE SELECT * FROM daily_measurements;
```

The raw sensor data flows in, gets aggregated into `daily_measurements`, and the dashboard receives live updates of the aggregated metrics. The `DROP` table discards raw readings after processing.

### Collaborative Editing

Use `LIVE SELECT DIFF` for efficient collaborative document editing:

```surql
-- Each client subscribes with DIFF to get minimal patches
LIVE SELECT DIFF FROM document:shared_doc;
```

Client-side application:

```javascript
const uuid = await db.live('document', (action, patches) => {
    if (action === 'UPDATE') {
        // Apply JSON Patch operations to local state
        for (const patch of patches) {
            applyPatch(localDocument, patch);
        }
        rerenderDocument();
    }
}, true); // diff mode = true
```

### Event Sourcing with Changefeeds

Use changefeeds to implement an event-sourcing pattern where all state changes are captured and replayable:

```surql
-- Define tables with changefeed retention
DEFINE TABLE order CHANGEFEED 30d INCLUDE ORIGINAL;
DEFINE TABLE payment CHANGEFEED 30d INCLUDE ORIGINAL;

-- Normal CRUD operations
CREATE order:001 SET customer = "alice", items = ["widget"], total = 29.99;
UPDATE order:001 SET status = "paid";

-- Replay all order changes from a specific point
SHOW CHANGES FOR TABLE order SINCE d"2024-01-01T00:00:00Z" LIMIT 1000;
```

External consumer pattern (polling):

```javascript
let lastVersionstamp = 0;

async function pollChanges() {
    const changes = await db.query(
        `SHOW CHANGES FOR TABLE order SINCE $vs LIMIT 100`,
        { vs: lastVersionstamp }
    );

    for (const changeset of changes) {
        for (const change of changeset.changes) {
            // Process: sync to data warehouse, trigger workflows, etc.
            await processChange(change);
        }
        lastVersionstamp = changeset.versionstamp;
    }
}

// Poll periodically
setInterval(pollChanges, 5000);
```

### Real-Time Presence Tracking

A full presence system using events, table views, and live queries:

```surql
-- Signal table: clients periodically CREATE records here
DEFINE TABLE signal_presence SCHEMALESS;

-- Event: convert signals into presence records
DEFINE EVENT signal_presence ON TABLE signal_presence
    WHEN $event == "CREATE"
    THEN (
        CREATE presence SET user = $auth.id, updated_at = time::now()
    );

-- Aggregated view: last presence per user
DEFINE TABLE last_presence AS
    SELECT
        user,
        time::max(updated_at) AS at
    FROM presence
    GROUP BY user;

-- Clients subscribe to presence changes
LIVE SELECT * FROM last_presence;
```

Client-side heartbeat:

```javascript
// Send presence signal every 10 seconds
setInterval(async () => {
    await db.query('CREATE signal_presence SET ts = time::now()');
}, 10_000);

// Subscribe to presence updates
const uuid = await db.live('last_presence', (action, result) => {
    updatePresenceUI(result);
});
```

### IoT Telemetry Pipeline

Anomaly detection using events, statistical functions, and HTTP webhooks:

```surql
-- Define sensor readings table with changefeed for replay
DEFINE TABLE sensor_readings CHANGEFEED 7d;

-- Real-time anomaly detection event
DEFINE EVENT sensor_anomaly ON sensor_readings
    WHEN $event = 'CREATE'
    THEN {
        LET $location = $after.location;
        LET $temp_past_hour = (
            SELECT VALUE temperature_celsius
            FROM sensor_readings
            WHERE location = $location
              AND created_at > time::now() - 1h
        );

        LET $low_threshold = math::percentile($temp_past_hour, 25)
            - 1.5 * math::interquartile($temp_past_hour);
        LET $high_threshold = math::percentile($temp_past_hour, 75)
            + 1.5 * math::interquartile($temp_past_hour);

        IF $after.temperature_celsius < $low_threshold
           OR $after.temperature_celsius > $high_threshold {
            http::post('https://alerts.example.com/anomaly', {
                body: {
                    location: $location,
                    temperature: $after.temperature_celsius,
                    thresholds: { low: $low_threshold, high: $high_threshold }
                }
            });
        };
    };

-- Dashboard subscribes to aggregated metrics
LIVE SELECT * FROM daily_measurements;
```

### Real-Time AI Pipeline

Combine live queries with SurrealDB's vector search for real-time AI-powered features:

```surql
-- When new content arrives, auto-generate embeddings
DEFINE EVENT embed_content ON TABLE article
    WHEN $event = "CREATE"
    THEN {
        UPDATE $after.id SET embedding = ml::predict(
            'text-embedding',
            { text: $after.title + " " + $after.body }
        );
    };

-- Live query for real-time similarity notifications
LIVE SELECT * FROM article
    WHERE embedding <|5,COSINE|> $user_interest_vector;
```

---

## Best Practices

### Live Query Management

1. **Always kill live queries** when the client disconnects or no longer needs them. Leaking live queries wastes server resources.

2. **Use WHERE clauses** to narrow live query scope. Fewer matching records means fewer notifications and lower server load.

3. **Prefer DIFF mode** for bandwidth-sensitive applications. Full record delivery on every field change is wasteful for large records.

4. **Subscribe first, query second** (Get and Subscribe pattern) to avoid missing changes between snapshot and subscription.

5. **Use table views for aggregation** rather than having every client compute aggregates from raw data:

```surql
-- Bad: Every client processes all raw data
LIVE SELECT * FROM raw_sensor_data;

-- Good: Server aggregates, clients get summaries
DEFINE TABLE hourly_metrics AS
    SELECT location, math::mean(value) AS avg
    FROM raw_sensor_data
    GROUP BY location;
LIVE SELECT * FROM hourly_metrics;
```

### Changefeed Management

6. **Set appropriate retention durations.** Shorter durations save storage; longer durations give more replay window. 1-7 days is typical for operational CDC, 30+ days for audit.

7. **Use INCLUDE ORIGINAL** only when you need before-state for diff computation or auditing. It doubles storage per change.

8. **Track versionstamps** in your consumer to resume from the correct position after restarts.

### Event Design

9. **Keep events simple** and avoid event chains. One event triggering another that triggers the first creates infinite loops.

10. **Use ASYNC for external calls** (HTTP webhooks, heavy computations). Synchronous events block the transaction.

11. **Set RETRY and MAXDEPTH** on async events to handle transient failures and prevent runaway recursion.

12. **Use --allow-net flag** when events need to make HTTP calls (`http::post`, `http::get`).

### Connection Architecture

13. **Use WebSocket for live queries**, not HTTP. Live queries require persistent connections.

14. **Implement reconnection logic** in clients. When a WebSocket drops, re-authenticate and re-establish live queries.

15. **Use CBOR over JSON** in production for binary efficiency, especially with high-frequency live query notifications.

---

## Key Takeaways

- **LIVE SELECT** provides push-based real-time notifications over WebSocket, with support for filtering (WHERE), JSON Patch diffs (DIFF), and linked record fetching (FETCH)
- **Changefeeds** (DEFINE TABLE ... CHANGEFEED) implement CDC for persistent, replayable change history with configurable retention
- **DEFINE EVENT** enables server-side automation with both synchronous (transactional) and asynchronous (background, retryable) execution modes
- The **WebSocket RPC protocol** supports JSON and CBOR formats, with a full suite of methods for auth, CRUD, queries, and live subscriptions
- The **Get and Subscribe** pattern (subscribe first, then snapshot) is the standard approach for real-time UIs
- **Table views + drop tables + live queries** combine for efficient real-time aggregation dashboards
- Live queries are currently **single-node only**; for distributed CDC, use changefeeds
- All major SDKs (JavaScript, Rust, Python, Go, Java, .NET, PHP) support live query subscriptions

---

*Research compiled: 2026-02-23 | Sources: SurrealDB official documentation, SurrealDB blog, DeepWiki (surrealdb/surrealdb), SurrealDB GitHub*
