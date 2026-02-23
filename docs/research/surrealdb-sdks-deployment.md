# SurrealDB SDKs, Deployment, and Ecosystem

> Research date: 2026-02-23 | Covers SurrealDB 2.x and 3.0

---

## Table of Contents

- [[#Official SDKs Overview]]
- [[#Rust SDK]]
- [[#JavaScript TypeScript SDK]]
- [[#Python SDK]]
- [[#Go SDK]]
- [[#Java SDK]]
- [[#.NET SDK]]
- [[#PHP SDK]]
- [[#C SDK]]
- [[#WebAssembly (Browser Embedded)]]
- [[#Connection Protocols]]
- [[#Surrealist (GUI/IDE)]]
- [[#Storage Engines]]
- [[#Deployment Options]]
- [[#SurrealDB Cloud]]
- [[#Embedding SurrealDB]]
- [[#SurrealDB 3.0 Ecosystem Changes]]

---

## Official SDKs Overview

SurrealDB provides official SDKs for nine languages/platforms. All SDKs share a consistent API surface with methods for connection, authentication, CRUD operations, live queries, and raw SurrealQL execution.

| SDK | Package | Min Version | Protocol Support | Embedding | Compatibility |
|-----|---------|-------------|-----------------|-----------|---------------|
| **Rust** | `surrealdb` crate | Rust 1.89+ | WS, HTTP, embedded | Yes (Mem, RocksDB, SurrealKV) | v2.0.0 - v2.6.2 |
| **JavaScript/TS** | `surrealdb` (npm/jsr) | ES2020+ | WS, HTTP | Yes (WASM, Node.js) | v2.0.0 - v3.0.0 |
| **Python** | `surrealdb` (PyPI) | Python 3.10+ | WS, HTTP | Yes (in-memory, file) | v2.0.0 - v2.6.1 |
| **Go** | `github.com/surrealdb/surrealdb.go` | Go 1.21+ | WS, HTTP | No (pending) | v2.0.0+ |
| **Java** | `com.surrealdb:surrealdb` (Maven) | JDK 8+ | WS, HTTP | Yes (in-memory) | v2.0.0 - v3.0.0 |
| **.NET** | `SurrealDb.Net` (NuGet) | .NET 6+ / .NET Standard 2.1 | WS, HTTP | Yes (embedded) | v2.0.0 - v3.0.0 |
| **PHP** | `surrealdb/surrealdb.php` (Composer) | PHP 8.2+ | WS, HTTP | No | v2.0.0 - v3.0.0 |
| **C** | Native library (Rust FFI) | C11+ | Via Rust bindings | Yes | v2.0.0+ |

### Common SDK Methods

All SDKs implement a consistent set of methods:

| Method | Description |
|--------|-------------|
| `connect` | Open a connection (WS/HTTP/embedded) |
| `use` | Select namespace and database |
| `signin` / `signup` | Authenticate or register users |
| `authenticate` | Validate/set a JWT token |
| `invalidate` | Revoke the current session |
| `create` | Create one or more records |
| `select` | Retrieve records by ID, table, or range |
| `update` | Replace a record entirely |
| `merge` | Partially update a record |
| `patch` | Apply JSON Patch operations |
| `delete` | Remove records |
| `insert` | Bulk insert records |
| `upsert` | Create or update records |
| `query` | Execute raw SurrealQL statements |
| `live` | Subscribe to real-time changes |
| `kill` | Terminate a live query subscription |

---

## Rust SDK

The Rust SDK (`surrealdb` crate) is the primary SDK and the foundation for several other SDKs (Python, Java, and C are built on top of the Rust core).

### Installation

```toml
# Cargo.toml
[dependencies]
surrealdb = "2"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
```

Feature flags control which storage engines are available:

```toml
# For remote connections only (default)
surrealdb = "2"

# With RocksDB embedded storage
surrealdb = { version = "2", features = ["kv-rocksdb"] }

# With SurrealKV embedded storage
surrealdb = { version = "2", features = ["kv-surrealkv"] }

# With in-memory storage
surrealdb = { version = "2", features = ["kv-mem"] }
```

### Remote Connection (WebSocket)

```rust
use surrealdb::engine::remote::ws::Ws;
use surrealdb::opt::auth::Root;
use surrealdb::Surreal;

#[tokio::main]
async fn main() -> surrealdb::Result<()> {
    // Connect to a remote server via WebSocket
    let db = Surreal::new::<Ws>("127.0.0.1:8000").await?;

    // Sign in as root
    db.signin(Root {
        username: "root",
        password: "secret",
    }).await?;

    // Select namespace and database
    db.use_ns("test").use_db("test").await?;

    Ok(())
}
```

### Remote Connection (HTTP)

```rust
use surrealdb::engine::remote::http::Http;
use surrealdb::opt::auth::Root;
use surrealdb::Surreal;

#[tokio::main]
async fn main() -> surrealdb::Result<()> {
    let db = Surreal::new::<Http>("127.0.0.1:8000").await?;
    db.signin(Root {
        username: "root",
        password: "secret",
    }).await?;
    db.use_ns("test").use_db("test").await?;
    Ok(())
}
```

### Embedded (In-Memory)

```rust
use serde::{Deserialize, Serialize};
use surrealdb::engine::local::Mem;
use surrealdb::RecordId;
use surrealdb::Surreal;

#[derive(Debug, Serialize)]
struct Person<'a> {
    title: &'a str,
    name: &'a str,
    marketing: bool,
}

#[derive(Debug, Deserialize)]
struct Record {
    id: RecordId,
}

#[tokio::main]
async fn main() -> surrealdb::Result<()> {
    // In-memory embedded database
    let db = Surreal::new::<Mem>(()).await?;
    db.use_ns("test").use_db("test").await?;

    // Create a record
    let created: Option<Record> = db
        .create("person")
        .content(Person {
            title: "Founder & CEO",
            name: "Tobie",
            marketing: true,
        })
        .await?;
    dbg!(created);

    // Select all people
    let people: Vec<Record> = db.select("person").await?;
    dbg!(people);

    // Run a custom query with bind variables
    let groups = db
        .query("SELECT marketing, count() FROM type::table($table) GROUP BY marketing")
        .bind(("table", "person"))
        .await?;
    dbg!(groups);

    Ok(())
}
```

### Embedded (RocksDB on Disk)

```rust
use surrealdb::engine::local::RocksDb;
use surrealdb::Surreal;

#[tokio::main]
async fn main() -> surrealdb::Result<()> {
    let db = Surreal::new::<RocksDb>("path/to/database-folder").await?;
    db.use_ns("test").use_db("test").await?;
    // Use like any other connection...
    Ok(())
}
```

### Dynamic Engine Selection (`Surreal<Any>`)

```rust
use surrealdb::engine::any::connect;

#[tokio::main]
async fn main() -> surrealdb::Result<()> {
    // The engine is chosen at runtime based on the endpoint string
    let db = connect("ws://localhost:8000").await?;
    // Or: connect("rocksdb://path/to/db").await?
    // Or: connect("mem://").await?
    // Or: connect("surrealkv://path/to/db").await?
    // Or: connect("tikv://localhost:2379").await?

    db.use_ns("test").use_db("test").await?;
    Ok(())
}
```

### Framework Integrations

The Rust SDK has documented integration guides for:
- **Actix Web** - Shared database connection via `web::Data`
- **Axum** - Database as state in router
- **Rocket** - Managed state
- **Egui** - Desktop GUI applications

---

## JavaScript TypeScript SDK

The JS/TS SDK (`surrealdb`) supports Node.js, Deno, Bun, and browsers. It uses the CBOR protocol for efficient binary serialization.

### Installation

```bash
# npm
npm install surrealdb

# pnpm
pnpm add surrealdb

# yarn
yarn add surrealdb

# Deno (JSR)
import Surreal from "@surrealdb/surrealdb";

# Browser CDN (prototyping only)
# https://unpkg.com/surrealdb
# https://cdn.jsdelivr.net/npm/surrealdb
```

### Basic Usage

```typescript
import { Surreal } from "surrealdb";

const db = new Surreal();

// Connect via WebSocket (preferred for live queries)
await db.connect("ws://127.0.0.1:8000/rpc");
// Or via HTTP
// await db.connect("http://127.0.0.1:8000/rpc");

// Authenticate
await db.signin({
    username: "root",
    password: "root",
});

// Select namespace and database
await db.use({ namespace: "test", database: "test" });

// Create a record
const person = await db.create("person", {
    title: "Founder & CEO",
    name: {
        first: "Tobie",
        last: "Morgan Hitchcock",
    },
    marketing: true,
});

// Select all records from a table
const people = await db.select("person");

// Update a specific record
const updated = await db.merge(new RecordId("person", "jaime"), {
    marketing: true,
});

// Run a raw SurrealQL query
const results = await db.query(
    "SELECT * FROM person WHERE marketing = $marketing",
    { marketing: true }
);

// Delete a record
await db.delete(new RecordId("person", "jaime"));

// Close the connection
await db.close();
```

### Live Queries

```typescript
import { Surreal } from "surrealdb";

const db = new Surreal();
await db.connect("ws://127.0.0.1:8000/rpc");
await db.signin({ username: "root", password: "root" });
await db.use({ namespace: "test", database: "test" });

// Subscribe to live changes on a table
const subscription = await db.live("person");

subscription.subscribe((action, result) => {
    switch (action) {
        case "CREATE":
            console.log("New person created:", result);
            break;
        case "UPDATE":
            console.log("Person updated:", result);
            break;
        case "DELETE":
            console.log("Person deleted:", result);
            break;
    }
});

// Kill the subscription when done
await db.kill(subscription.id);
```

### Connection Options

```typescript
const db = new Surreal();
await db.connect("ws://127.0.0.1:8000/rpc", {
    namespace: "test",
    database: "test",
    auth: { username: "root", password: "root" },
    // Automatic version checking
    versionCheck: true,
    // Reconnection settings (WebSocket only)
    // The SDK auto-reconnects by default
});
```

### Custom Types

The SDK provides custom types for SurrealDB-specific data:

```typescript
import { RecordId, Uuid, Duration, Geometry } from "surrealdb";

// Record IDs
const id = new RecordId("person", "tobie");
const id2 = new RecordId("person", 123);

// UUIDs
const uuid = new Uuid("550e8400-e29b-41d4-a716-446655440000");

// Geometry
const point = new Geometry.Point([51.5074, -0.1278]);
```

---

## Python SDK

The Python SDK (`surrealdb` on PyPI) is built on top of the Rust SDK core via PyO3 bindings, providing both synchronous and asynchronous APIs.

### Installation

```bash
pip install surrealdb
# or
poetry add surrealdb
# or
uv add surrealdb
```

Current stable version: **1.0.8** (Jan 2026)

### Synchronous Usage

```python
from surrealdb import Surreal

# Connect using context manager (auto-closes)
with Surreal("ws://localhost:8000") as db:
    db.use("test", "test")
    db.signin({"username": "root", "password": "root"})

    # Create a record
    person = db.create("person", {
        "name": "John",
        "age": 30,
        "email": "john@example.com"
    })
    print(person)

    # Select all records
    people = db.select("person")
    print(people)

    # Run a query
    results = db.query(
        "SELECT * FROM person WHERE age > $min_age",
        {"min_age": 25}
    )
    print(results)
```

### Asynchronous Usage

```python
import asyncio
from surrealdb import AsyncSurreal

async def main():
    async with AsyncSurreal("ws://localhost:8000") as db:
        await db.use("test", "test")
        await db.signin({"username": "root", "password": "root"})

        # Create
        person = await db.create("person", {
            "name": "Alice",
            "age": 28
        })

        # Select
        people = await db.select("person")

        # Query
        results = await db.query(
            "SELECT * FROM person WHERE age > $min_age",
            {"min_age": 25}
        )

asyncio.run(main())
```

### Embedded Database (In-Memory)

```python
import asyncio
from surrealdb import AsyncSurreal

async def main():
    # Create an in-memory database (use "mem://" or "memory")
    async with AsyncSurreal("memory") as db:
        await db.use("test", "test")
        await db.signin({"username": "root", "password": "root"})

        person = await db.create("person", {
            "name": "John Doe",
            "age": 30,
        })
        print(person)

asyncio.run(main())
```

### File-Based Persistent Database

```python
from surrealdb import AsyncSurreal

async def main():
    # Persistent storage with SurrealKV
    async with AsyncSurreal("surrealkv://./my_database") as db:
        await db.use("test", "test")
        await db.signin({"username": "root", "password": "root"})
        # Data persists across restarts
```

### Connection Protocols

```python
# HTTP
db = Surreal("http://localhost:8000")

# HTTPS
db = Surreal("https://cloud.surrealdb.com")

# WebSocket (preferred for live queries)
db = Surreal("ws://localhost:8000")

# Secure WebSocket
db = AsyncSurreal("wss://cloud.surrealdb.com")

# Embedded in-memory
db = AsyncSurreal("memory")

# Embedded SurrealKV on disk
db = AsyncSurreal("surrealkv://./path/to/db")
```

### Observability (Logfire Integration)

```python
import logfire
from surrealdb import AsyncSurreal

logfire.configure()
logfire.instrument_surrealdb()

async with AsyncSurreal("ws://localhost:8000") as db:
    await db.signin({"username": "root", "password": "root"})
    await db.use("test", "test")
    # All operations are now automatically traced
    await db.create("person", {"name": "Alice"})
```

---

## Go SDK

### Installation

```bash
go get github.com/surrealdb/surrealdb.go
```

### Basic Usage

```go
package main

import (
    "context"
    "fmt"

    surrealdb "github.com/surrealdb/surrealdb.go"
    "github.com/surrealdb/surrealdb.go/pkg/models"
)

type Person struct {
    ID       *models.RecordID `json:"id,omitempty"`
    Name     string           `json:"Name"`
    Surname  string           `json:"Surname"`
    Location models.GeometryPoint `json:"Location"`
}

func main() {
    ctx := context.Background()

    // Connect via WebSocket
    db, err := surrealdb.FromEndpointURLString(ctx, "ws://localhost:8000")
    if err != nil {
        panic(err)
    }

    // Set namespace and database
    if err = db.Use(ctx, "testNS", "testDB"); err != nil {
        panic(err)
    }

    // Authenticate
    authData := &surrealdb.Auth{
        Username: "root",
        Password: "root",
    }
    token, err := db.SignIn(ctx, authData)
    if err != nil {
        panic(err)
    }
    if err := db.Authenticate(ctx, token); err != nil {
        panic(err)
    }

    // Create a record
    person, err := surrealdb.Create[Person](ctx, db, models.Table("persons"), map[any]any{
        "Name":     "John",
        "Surname":  "Doe",
        "Location": models.NewGeometryPoint(-0.11, 22.00),
    })
    if err != nil {
        panic(err)
    }
    fmt.Printf("Created: %+v\n", person)

    // Select a single record
    retrieved, err := surrealdb.Select[Person, models.RecordID](ctx, db, *person.ID)
    if err != nil {
        panic(err)
    }
    fmt.Printf("Retrieved: %+v\n", retrieved)

    // Select all records from table
    allPersons, err := surrealdb.Select[[]Person, models.Table](ctx, db, models.Table("persons"))
    if err != nil {
        panic(err)
    }
    fmt.Printf("All: %+v\n", allPersons)

    // Delete a record
    if err = surrealdb.Delete[Person](ctx, db, *person.ID); err != nil {
        panic(err)
    }
}
```

### Connection Schemes

```go
// WebSocket
db, _ := surrealdb.FromEndpointURLString(ctx, "ws://localhost:8000")

// Secure WebSocket
db, _ := surrealdb.FromEndpointURLString(ctx, "wss://cloud.surrealdb.com")

// HTTP
db, _ := surrealdb.FromEndpointURLString(ctx, "http://localhost:8000")

// HTTPS
db, _ := surrealdb.FromEndpointURLString(ctx, "https://cloud.surrealdb.com")
```

> **Note:** `surrealdb.New()` and `surrealdb.Connect()` are deprecated. Use `surrealdb.FromEndpointURLString()` instead.

### Live Queries (WebSocket Only)

```go
// Subscribe to live notifications
queryResult, err := surrealdb.Live[Person](ctx, db, models.Table("persons"), false)
if err != nil {
    panic(err)
}

// Read notifications channel
notifications := db.LiveNotifications(queryResult.ID)
for notification := range notifications {
    fmt.Printf("Action: %s, Result: %+v\n", notification.Action, notification.Result)
}
```

---

## Java SDK

### Installation

**Gradle:**
```groovy
ext {
    surrealdbVersion = "0.2.1"
}
dependencies {
    implementation "com.surrealdb:surrealdb:${surrealdbVersion}"
}
```

**Gradle Kotlin DSL:**
```kotlin
val surrealdbVersion by extra("0.2.1")
dependencies {
    implementation("com.surrealdb:surrealdb:${surrealdbVersion}")
}
```

**Maven:**
```xml
<dependency>
    <groupId>com.surrealdb</groupId>
    <artifactId>surrealdb</artifactId>
    <version>0.2.1</version>
</dependency>
```

### Basic Usage

```java
import com.surrealdb.Surreal;
import com.surrealdb.RecordId;

public class Example {
    public static void main(String[] args) {
        try (Surreal surreal = new Surreal()) {
            // Connect to an in-memory database
            surreal.connect("memory");

            // Or connect to a remote server
            // surreal.connect("ws://localhost:8000");

            // Set namespace and database
            surreal.use("test", "test");

            // Sign in
            surreal.signin("root", "root");

            // Create a record
            Book book = new Book(
                "Aeon's Surreal Renaissance",
                "Dave MacLeod",
                true
            );
            Book created = surreal.create(Book.class, "book", book).get(0);
            System.out.println("Created: " + created.id);

            // Create with a specific ID
            Book specific = surreal.create(
                Book.class,
                new RecordId("book", "surreal-101"),
                book
            );

            // Select all records
            List<Book> books = surreal.select(Book.class, "book");

            // Run a query
            List<QueryResult<Book>> results = surreal.query(
                Book.class,
                "SELECT * FROM book WHERE available = $available",
                Map.of("available", true)
            );
        }
    }
}
```

> **Note:** The Java SDK is built on top of the Rust core and compatible with SurrealDB v2.0.0 to v3.0.0. API is not yet fully stabilized (pre-1.0).

---

## .NET SDK

### Installation

```bash
dotnet add package SurrealDb.Net
```

Or in `.csproj`:
```xml
<PackageReference Include="SurrealDb.Net" Version="0.9.0" />
```

### Basic Usage (Manual Client)

```csharp
using SurrealDb.Net;
using SurrealDb.Net.Models;
using SurrealDb.Net.Models.Auth;

// Create a client
var client = new SurrealDbClient("ws://127.0.0.1:8000/rpc");

// Authenticate
await client.SignIn(new RootAuth { Username = "root", Password = "root" });

// Select namespace and database
await client.Use("test", "test");

// Create a record
var person = await client.Create("person", new {
    Title = "Founder",
    Name = "Tobie",
    Marketing = true
});

// Select all records
var people = await client.Select<Person>("person");

// Run a query
var queryResult = await client.Query("SELECT * FROM person WHERE marketing = true");

// Close connection
await client.Close();
```

### Dependency Injection (ASP.NET Core)

```csharp
// Program.cs
builder.Services.AddSurreal(options =>
{
    options.Endpoint = "ws://127.0.0.1:8000/rpc";
    options.Namespace = "test";
    options.Database = "test";
});

// In a controller or service
public class PersonController : ControllerBase
{
    private readonly ISurrealDbClient _db;

    public PersonController(ISurrealDbClient db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> GetPeople()
    {
        var people = await _db.Select<Person>("person");
        return Ok(people);
    }
}
```

### Embedded Mode

The .NET SDK supports embedded SurrealDB:

```csharp
// In-memory
var client = new SurrealDbClient("mem://");

// File-based with RocksDB
var client = new SurrealDbClient("rocksdb://path/to/database");

// File-based with SurrealKV
var client = new SurrealDbClient("surrealkv://path/to/database");
```

### Connection Strings

```
ws://127.0.0.1:8000/rpc       // WebSocket
wss://cloud.surrealdb.com/rpc // Secure WebSocket
http://127.0.0.1:8000         // HTTP
https://cloud.surrealdb.com   // HTTPS
mem://                         // In-memory embedded
rocksdb://path/to/db           // RocksDB embedded
surrealkv://path/to/db         // SurrealKV embedded
```

> **Note:** Compatible with SurrealDB v2.0.0 to v3.0.0. Supports .NET 6+, .NET 8 LTS, .NET 9, and .NET 10.

---

## PHP SDK

### Installation

```bash
composer require surrealdb/surrealdb.php
```

Requires PHP 8.2+.

### Basic Usage

```php
<?php
require_once __DIR__ . '/vendor/autoload.php';

use Surreal\Surreal;

// Create a new instance (HTTP or WebSocket)
$db = new Surreal();

// Connect to SurrealDB
$db->connect("http://localhost:8000");
// Or WebSocket: $db->connect("ws://localhost:8000");

// Authenticate
$db->signin([
    "username" => "root",
    "password" => "root"
]);

// Select namespace and database
$db->use([
    "namespace" => "test",
    "database" => "test"
]);

// Create a record
$person = $db->create("person", [
    "name" => "John Doe",
    "age" => 30,
    "email" => "john@example.com"
]);

// Select all records
$people = $db->select("person");

// Query with variables
$results = $db->query(
    "SELECT * FROM person WHERE age > $min_age",
    ["min_age" => 25]
);

// Update a record
$db->merge("person:john", [
    "age" => 31
]);

// Delete a record
$db->delete("person:john");

// Close connection
$db->close();
```

### Framework Integrations

The PHP SDK has documented integration guides for:
- **Laravel** - Service provider and facade
- **Symfony** - Service configuration

> **Note:** The PHP SDK uses the CBOR protocol for efficient data serialization. Compatible with SurrealDB v2.0.0 to v3.0.0.

---

## C SDK

The C SDK is built as a native library using Rust FFI (Foreign Function Interface), wrapping the core Rust SDK.

### Key Points

- Built on the Rust SDK core
- Provides a C-compatible ABI for linking from any language that supports C FFI
- Supports native data types including `Uuid`, `RecordId`, and `Geometry`
- Custom types for `strings`, `numbers`, `floats`, and `booleans`
- Available from the SurrealDB GitHub organization (`surrealdb/surrealdb.c`)

> **Note:** The C SDK is less documented than other SDKs. For most use cases, consider using the Rust SDK directly or one of the higher-level language SDKs which are built on the Rust core.

---

## WebAssembly (Browser Embedded)

SurrealDB can run directly in the browser via WebAssembly, using either in-memory storage or IndexedDB for persistence.

### Installation

```bash
# Install the JS SDK and WASM engine
npm install surrealdb @surrealdb/wasm
```

### In-Memory (Browser)

```typescript
import { Surreal } from 'surrealdb';
import { surrealdbWasmEngines } from '@surrealdb/wasm';

// Register the WASM engines
const db = new Surreal({
    engines: surrealdbWasmEngines(),
});

// Connect to in-memory database
await db.connect("mem://");
await db.use({ namespace: "test", database: "test" });

// Use like any other SurrealDB connection
const person = await db.create("person", {
    name: "John Doe",
    age: 30,
});
```

### IndexedDB Persistence (Browser)

```typescript
import { Surreal } from 'surrealdb';
import { surrealdbWasmEngines } from '@surrealdb/wasm';

const db = new Surreal({
    engines: surrealdbWasmEngines(),
});

// Connect to IndexedDB-backed database
// Data persists across browser sessions and page reloads
await db.connect("indxdb://myAppDatabase");
await db.use({ namespace: "test", database: "test" });

// All CRUD operations work the same way
await db.create("person", { name: "Alice", age: 25 });
const people = await db.select("person");
```

### Node.js Embedded Engine

```bash
npm install surrealdb @surrealdb/node
```

```typescript
import { Surreal } from 'surrealdb';
import { surrealdbNodeEngines } from '@surrealdb/node';

const db = new Surreal({
    engines: surrealdbNodeEngines(),
});

// In-memory
await db.connect("mem://");

// Or SurrealKV persistent storage
await db.connect("surrealkv://./my-database");

await db.use({ namespace: "test", database: "test" });
```

### Vite Configuration

When using Vite with the WASM engine:

```typescript
// vite.config.ts
export default defineConfig({
    optimizeDeps: {
        exclude: ["@surrealdb/wasm"],
        esbuildOptions: {
            target: "esnext",
        },
    },
    esbuild: {
        supported: {
            "top-level-await": true,
        },
    },
});
```

### Engine Selection Guide

| Engine | Package | Protocols | Best For |
|--------|---------|-----------|----------|
| **WASM** | `@surrealdb/wasm` | `mem://`, `indxdb://` | Browser apps, offline-first |
| **Node.js** | `@surrealdb/node` | `mem://`, `surrealkv://` | Server-side embedded |
| **Remote** | (built-in) | `ws://`, `wss://`, `http://`, `https://` | Client-server architecture |

---

## Connection Protocols

### WebSocket (WS/WSS)

- **Default and preferred** protocol for remote connections
- Enables real-time features: live queries, subscriptions
- Persistent, bidirectional connection
- Automatic reconnection on disconnect (in most SDKs)
- Session-based: after initial auth, the session persists until expiry or disconnect
- Default session duration: `NONE` (never expires unless configured)

### HTTP (HTTP/HTTPS)

- Stateless request-response protocol
- Each request is independent; tokens must be sent with every request
- Token expiration matters more than session duration
- Better for serverless / short-lived connections
- No live query support (requires WebSocket)

### RPC Protocol

SurrealDB uses a JSON-RPC-like protocol over both WebSocket and HTTP. Since 2.0, the SDKs use **CBOR** (Concise Binary Object Representation) for more efficient binary serialization.

### Choosing a Protocol

| Use Case | Recommended Protocol |
|----------|---------------------|
| Real-time apps, live queries | WebSocket (`ws://` / `wss://`) |
| REST APIs, serverless functions | HTTP (`http://` / `https://`) |
| Browser offline-first | WASM (`mem://` / `indxdb://`) |
| Server-side embedded | Native (`mem://` / `rocksdb://` / `surrealkv://`) |

---

## Surrealist (GUI/IDE)

Surrealist is the official graphical user interface for SurrealDB -- a modern, full-featured database management tool.

### Availability

| Platform | How to Access |
|----------|---------------|
| **Web App** | [app.surrealdb.com](https://app.surrealdb.com) |
| **macOS Desktop** | Download from [surrealdb.com/surrealist](https://surrealdb.com/surrealist) (Tauri-based) |
| **Windows Desktop** | Download `.exe` installer |
| **Linux Desktop** | `.deb`, `.rpm`, `.AppImage` packages |
| **Docker Extension** | Available in Docker Desktop Extensions Marketplace |

Current version: **Surrealist 3.7.2** (Feb 2026) -- compatible with SurrealDB 2.x and 3.x.

### Key Features

- **Query Editor** - Write and execute SurrealQL with syntax highlighting, auto-complete, and query history
- **Table Explorer** - Browse records visually, follow record links, edit entries directly
- **Schema Designer** - Visual schema design with table/field/index management
- **Graph Visualizer** - Visualize graph relationships between records
- **Authentication Manager** - Manage users, access methods, and permissions
- **Functions View** - Create and manage stored procedures
- **API Docs** - Auto-generated API documentation from your schema
- **Live Query Monitor** - Watch real-time data changes
- **Multiple Connections** - Manage connections to multiple SurrealDB instances
- **Sandbox Mode** - Test queries safely in an isolated environment (desktop only)
- **Connection Templates** - Reusable connection configurations
- **Surreal Cloud Panel** - Integrated cloud instance management

### Surreal Sidekick

Surrealist includes **Surreal Sidekick**, an AI assistant accessible from the Surreal Cloud panel that can:
- Debug SurrealQL queries
- Answer questions based on latest documentation
- Optimize query performance
- Suggest schema improvements

### Desktop vs Web

| Feature | Web App | Desktop App |
|---------|---------|-------------|
| Query editor | Yes | Yes |
| Remote connections | Yes | Yes |
| Local database serving | No | Yes |
| Open files from disk | No | Yes |
| Sandbox mode | No | Yes |
| Cloud panel | Yes | Yes |

---

## Storage Engines

SurrealDB supports multiple storage backends, selectable at startup time.

### Engine Comparison

| Engine | Type | Persistence | Use Case | Production Ready | Connection String |
|--------|------|-------------|----------|-----------------|-------------------|
| **In-Memory** | Embedded | No | Testing, dev, caching | Yes (ephemeral) | `mem://` or `memory` |
| **RocksDB** | Embedded | Yes (disk) | Single-node production | Yes (default) | `rocksdb://path/to/db` |
| **SurrealKV** | Embedded | Yes (disk) | Versioned queries, experimental | Beta | `surrealkv://path/to/db` |
| **TiKV** | Distributed | Yes (cluster) | Multi-node, HA production | Yes | `tikv://pd-host:2379` |
| **FoundationDB** | Distributed | Yes (cluster) | Multi-node alternative | Experimental | `fdb://cluster-file` |
| **IndexedDB** | Browser | Yes (browser) | WASM browser apps | Yes (browser) | `indxdb://DatabaseName` |

### RocksDB (Default)

- Originally forked from Google's LevelDB, developed by Meta
- Uses **Log-Structured Merge-tree (LSM)** data structure
- Optimized for fast, low-latency storage on flash/SSD drives
- LSM is highly efficient for write-heavy workloads
- Default and recommended engine for single-node production
- Concurrent readers and writers supported

```bash
# Start with RocksDB
surreal start --user root --pass secret rocksdb://./mydata.db

# Docker
docker run --rm -p 8000:8000 -v /data:/data \
    surrealdb/surrealdb:latest start \
    --user root --pass secret \
    rocksdb:///data/mydata.db
```

### SurrealKV

- Custom storage engine built by SurrealDB, written entirely in Rust
- Uses an **Immutable Versioned Adaptive Radix Trie (VART)** data structure
- Stores the entire index in memory (versioned in-memory key-value store)
- Designed for unique capabilities:
  - Versioned queries over time
  - Immutable data querying
  - Historic aggregate query analysis
  - Versioned graph queries
- **Still in beta** -- RocksDB is still recommended for production
- Append-only format makes replication straightforward
- CRC verification for data integrity during recovery

```bash
# Start with SurrealKV
surreal start --user root --pass secret surrealkv://./mydata.db

# Versioned mode
surreal start --user root --pass secret surrealkv+versioned://./mydata.db
```

**Performance Note (v2.2 benchmarks):** SurrealKV currently underperforms RocksDB in most CRUD benchmarks. The SurrealDB team states RocksDB is still the primary KV engine; SurrealKV's purpose is to enable new use cases like versioning, not to replace RocksDB.

### TiKV (Distributed)

- Distributed, transactional KV database from PingCAP
- Built in Rust, uses the **Raft consensus algorithm**
- Uses RocksDB (LSM) as the underlying per-node storage engine
- ACID compliant with support for multiple concurrent readers and writers
- Horizontally scalable to 100+ terabytes
- Inspired by Google's BigTable, Spanner, and Percolator

```bash
# Start TiKV development cluster (single-node, for dev only)
tiup playground --tag surrealdb --mode tikv-slim --pd 1 --kv 1

# Start SurrealDB on TiKV
surreal start --user root --pass secret tikv://127.0.0.1:2379
```

### FoundationDB

- Distributed, transactional KV database from Apple
- Built in C++, uses the **Paxos consensus algorithm**
- B-tree based on SQLite as underlying storage
- Alternative to TiKV for distributed deployments
- Experimental support in SurrealDB

### In-Memory

- BTreeMap-based storage, no persistence
- Fastest performance (all data in RAM)
- Data lost when connection closes
- Ideal for testing, development, and ephemeral workloads
- In SurrealDB 3.0: new in-memory engine with lock-free MVCC design

```bash
surreal start --user root --pass secret memory
```

### SurrealDB 3.0 In-Memory Engine

SurrealDB 3.0 introduces an improved in-memory engine:
- Lock-free, MVCC-based design
- Full ACID transactions
- Massive concurrency with predictable performance
- Optional background persistence

---

## Deployment Options

### Single-Node (Development / Small Production)

The simplest deployment -- a single SurrealDB binary with a local storage engine.

#### Install on macOS

```bash
brew install surrealdb/tap/surreal
```

#### Install on Linux

```bash
curl -sSf https://install.surrealdb.com | sh
```

#### Install on Windows

```powershell
iwr https://windows.surrealdb.com -useb | iex
# Or via Chocolatey
choco install surreal
# Or via Scoop
scoop install surrealdb
```

#### Start a Single-Node Server

```bash
# In-memory (development)
surreal start --user root --pass secret memory

# Disk-based with RocksDB (production)
surreal start --user root --pass secret rocksdb://./mydata.db

# Disk-based with SurrealKV
surreal start --user root --pass secret surrealkv://./mydata.db

# Custom port and logging
surreal start --user root --pass secret --bind 0.0.0.0:9000 --log debug rocksdb://./mydata.db
```

### Docker

```bash
# In-memory
docker run --rm -p 8000:8000 surrealdb/surrealdb:latest start \
    --user root --pass secret memory

# Persistent with RocksDB (mount a volume)
docker run --rm -p 8000:8000 -v /local-dir:/data \
    surrealdb/surrealdb:latest start \
    --user root --pass secret rocksdb:///data/mydatabase.db

# Non-root user (recommended for production)
docker run --rm -p 8000:8000 -v /local-dir:/data \
    --user 1000:1000 \
    surrealdb/surrealdb:latest start \
    --user root --pass secret rocksdb:///data/mydatabase.db
```

### Docker Compose (Multi-Node with TiKV)

SurrealDB provides an official Docker Compose configuration at `docker.surrealdb.com`:

```bash
# Fetch the default config
curl -sSf https://docker.surrealdb.com -o docker-compose.yml

# Start the cluster
docker compose up --pull=always -d
```

This spins up a multi-node cluster with TiKV for development/testing. For production TiKV deployments, refer to the official TiKV documentation.

### Kubernetes with TiKV (Helm Chart)

Full distributed deployment using the SurrealDB Helm chart:

#### 1. Set Up TiDB Operator (manages TiKV)

```bash
# Install TiDB CRDs
kubectl create -f https://raw.githubusercontent.com/pingcap/tidb-operator/v1.4.7/manifests/crd.yaml

# Install TiDB Operator via Helm
helm repo add pingcap https://charts.pingcap.org
helm install --namespace tidb-operator --create-namespace \
    tidb-operator pingcap/tidb-operator --version v1.4.7
```

#### 2. Deploy TiKV Cluster

```bash
kubectl create ns tikv
kubectl apply -n tikv -f https://raw.githubusercontent.com/pingcap/tidb-operator/v1.4.7/examples/basic/tidb-cluster.yaml
# Wait for cluster to be ready
kubectl get -n tikv tidbcluster
```

#### 3. Install SurrealDB via Helm

```bash
helm repo add surrealdb https://helm.surrealdb.com
helm repo update

# Get TiKV PD service URL
TIKV_URL=$(kubectl get svc -n tikv basic-pd -o jsonpath='{.spec.clusterIP}')

# Install SurrealDB
helm install surrealdb surrealdb/surrealdb \
    --set surrealdb.path="tikv://${TIKV_URL}:2379" \
    --set surrealdb.auth=true \
    --set surrealdb.username=root \
    --set surrealdb.password=surrealdb
```

### Managed Kubernetes

SurrealDB has specific deployment guides for:

| Platform | Guide |
|----------|-------|
| **Amazon EKS** | Deploy on Amazon EKS |
| **Google GKE** | Deploy on Google GKE |
| **Azure AKS** | Deploy on Azure AKS |

All follow the same pattern: TiDB Operator + TiKV cluster + SurrealDB Helm chart.

### Architecture: Distributed with TiKV

In a production HA (High Availability) deployment:

```
                    +---------+
                    |  Load   |
                    | Balancer|
                    +----+----+
                         |
            +------------+------------+
            |            |            |
       +----+----+  +----+----+  +----+----+
       |SurrealDB|  |SurrealDB|  |SurrealDB|
       | Node 1  |  | Node 2  |  | Node 3  |
       +----+----+  +----+----+  +----+----+
            |            |            |
       +----+----+  +----+----+  +----+----+
       |  TiKV   |  |  TiKV   |  |  TiKV   |
       | Node 1  |  | Node 2  |  | Node 3  |
       +---------+  +---------+  +---------+
            |            |            |
       +----+----+  +----+----+  +----+----+
       |   PD    |  |   PD    |  |   PD    |
       | Node 1  |  | Node 2  |  | Node 3  |
       +---------+  +---------+  +---------+
```

- **SurrealDB nodes**: Stateless compute layer (can scale horizontally)
- **TiKV nodes**: Distributed storage layer (Raft consensus)
- **PD (Placement Driver)**: Cluster metadata and scheduling

### Reverse Proxy Configuration

For production, place SurrealDB behind a reverse proxy for TLS termination and load balancing.

**Nginx example:**
```nginx
upstream surrealdb {
    server 127.0.0.1:8000;
}

server {
    listen 443 ssl;
    server_name db.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://surrealdb;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### TLS Native Configuration

```bash
surreal start \
    --web-crt /path/to/cert.pem \
    --web-key /path/to/key.pem \
    --client-crt /path/to/client.pem \
    --client-key /path/to/client-key.pem \
    rocksdb://./data
```

---

## SurrealDB Cloud

SurrealDB Cloud is a fully managed database-as-a-service offering.

### Tiers

| Tier | Price | Resources | Features |
|------|-------|-----------|----------|
| **Free** | $0 | 1 GB storage, 0.25 vCPU, 1 GB RAM | Single node, social auth, Cloud RBAC, Sidekick |
| **Start** | From $0.021/hr | Up to 512 GB storage, 16 vCPU, 64 GB RAM | Vertical scalability, daily backups, single node |
| **Scale** | Custom | Up to 5 TB cluster, 32 vCPU/node, 128 GB RAM/node | Horizontal scalability, fault tolerance, multi-node |
| **Enterprise** | Custom | Up to 1 PB cluster, 64 vCPU/node, 256 GB RAM/node | Dedicated clusters, BYOK encryption, PrivateLink, custom SLAs |

### Regions

- **EU (Frankfurt)** - Available
- **US** - Launched (2025)
- **Sao Paulo** - Planned (2026 H1)

### Cloud Features

- Automated daily managed backups
- Instance metrics, query logs, and traces
- Team collaboration with Cloud RBAC and ABAC
- Workload isolation with centralized data (Scale+)
- Compute-compute separation (Scale+)
- Observability and monitoring
- SOC 2 Type 2, ISO 27001, Cyber Essentials Plus compliance
- HIPAA compliance (optional add-on for Scale/Enterprise)

### Connecting to Cloud

```typescript
// JavaScript SDK
const db = new Surreal();
await db.connect("wss://your-instance.cloud.surrealdb.com/rpc");
await db.signin({ username: "root", password: "your-password" });
await db.use({ namespace: "production", database: "myapp" });
```

```bash
# CLI
surreal sql --conn 'wss://your-instance.cloud.surrealdb.com' \
    --user root --pass your-password
```

### AWS Marketplace

SurrealDB Cloud Enterprise Edition is available on AWS Marketplace with usage-based pricing ($0.001/unit overage).

### Self-Hosted Licensing

SurrealDB is source-available under the **Business Source License (BSL) 1.1**:
- **Free** for non-commercial use (dev, testing, internal)
- **Commercial license required** for SaaS or cloud providers offering SurrealDB as a service
- BSL transitions to open-source after a set period

---

## Embedding SurrealDB

SurrealDB can be embedded directly within your application, eliminating the need for a separate server process.

### Supported Embedding Environments

| Language | Engines | Package |
|----------|---------|---------|
| **Rust** | `Mem`, `RocksDb`, `SurrealKv`, `SpeeDb` | `surrealdb` crate with feature flags |
| **JavaScript (Browser)** | `mem://`, `indxdb://` | `surrealdb` + `@surrealdb/wasm` |
| **JavaScript (Node.js)** | `mem://`, `surrealkv://` | `surrealdb` + `@surrealdb/node` |
| **Python** | `memory`, `surrealkv://` | `surrealdb` (PyPI) |
| **.NET** | `mem://`, `rocksdb://`, `surrealkv://` | `SurrealDb.Net` (NuGet) |
| **Java** | `memory` | `com.surrealdb:surrealdb` (Maven) |

### When to Embed

- **Testing** - In-memory databases for unit/integration tests
- **Desktop apps** - Local data persistence without a server
- **Browser apps** - Offline-first with IndexedDB persistence
- **Edge/IoT** - Resource-constrained devices with SurrealKV
- **Mobile** - Via WASM or native SDK bindings
- **Prototyping** - Quick iteration without server setup

### Embedding Best Practices

- Embedded databases are **single-process** -- only one application instance can access the data files at a time
- For multi-process or distributed access, use a remote SurrealDB server
- Always close connections properly to avoid data corruption
- Use `mem://` for tests, `surrealkv://` or `rocksdb://` for persistent embedded use

---

## SurrealDB 3.0 Ecosystem Changes

SurrealDB 3.0 (released Feb 2026) brought significant changes across the entire ecosystem.

### Performance Improvements

| Metric | Improvement |
|--------|-------------|
| Graph queries | 4-24x faster |
| Query planner (`WHERE id = record:42`) | 4,600x+ smarter (sub-millisecond) |
| Table scans with LIMIT/START | 3-7x faster |
| ORDER BY queries | 3-4x faster |
| HNSW vector search | ~8x faster |
| SELECT FETCH | ~5x faster |

### New Execution Engine

- Rearchitected from scratch: **AST -> LogicalPlan -> ExecutionPlan** pipeline
- Fully streaming internally (end-to-end client streaming coming)
- Better concurrency and throughput
- Smarter query planner with compound and descending index support

### New Features in 3.0

- **Custom API Endpoints** - Define HTTP routes directly in the database using SurrealQL
- **Client-Side Transactions** - Group operations across multiple requests, commit when ready
- **Record References** - New way to reference records across tables
- **File Storage** - Native file/bucket support in SurrealQL (images, audio, documents)
- **Surrealism** - WASM extension system for running custom Rust logic inside the database
- **Surqlize** - TypeScript ORM for SurrealDB (experimental)
- **Surreal Sync** - Data migration tool
- **GraphQL** - Now stable (was experimental in 2.x)
- **Computed Fields** - Fields that are computed from expressions
- **Improved In-Memory Engine** - Lock-free MVCC design

### SDK Compatibility with 3.0

| SDK | 3.0 Compatibility |
|-----|-------------------|
| Rust | v2.0.0 - v2.6.2 (3.0 SDK in progress) |
| JavaScript/TypeScript | v2.0.0 - v3.0.0 |
| Java | v2.0.0 - v3.0.0 |
| .NET | v2.0.0 - v3.0.0 |
| PHP | v2.0.0 - v3.0.0 |
| Python | v2.0.0 - v2.6.1 (3.0 update in progress) |
| Go | v2.0.0+ (3.0 update in progress) |

### Migration Guide

SurrealDB provides an upgrade guide from 2.x to 3.0 and the **Surreal Sync** tool for data migration.

```bash
# Upgrade the binary
surreal upgrade

# Or install specific version
surreal upgrade --version 3.0.0
```

---

## Quick Reference: Starting SurrealDB

```bash
# In-memory development server
surreal start memory

# Single-node persistent (RocksDB)
surreal start --user root --pass secret rocksdb://./data

# Single-node persistent (SurrealKV)
surreal start --user root --pass secret surrealkv://./data

# Distributed cluster (TiKV)
surreal start --user root --pass secret tikv://pd-host:2379

# Docker (in-memory)
docker run --rm -p 8000:8000 surrealdb/surrealdb:latest start memory

# Docker (persistent)
docker run --rm -p 8000:8000 -v $(pwd)/data:/data \
    surrealdb/surrealdb:latest start \
    --user root --pass secret rocksdb:///data/mydb

# Docker (SurrealDB 3.0)
docker run --rm -p 8000:8000 surrealdb/surrealdb:3 start memory

# With TLS
surreal start --web-crt cert.pem --web-key key.pem rocksdb://./data

# Custom bind address and log level
surreal start --bind 0.0.0.0:9000 --log debug rocksdb://./data
```

---

## Related Notes

- [[SurrealDB 3.0 Overview]] - Core features and architecture
- [[SurrealQL Deep Dive]] - Query language reference
- [[SurrealDB Authentication and Security]] - Auth, RBAC, permissions
- [[SurrealDB Data Model]] - Documents, graphs, relations
- [[SurrealDB Real-Time and Live Queries]] - Changefeeds and subscriptions
- [[SurrealDB Advanced Features]] - Functions, analyzers, indexes
- [[SurrealML and AI Capabilities]] - Vector search, ML models
- [[SurrealDB MCP Server]] - Model Context Protocol integration
