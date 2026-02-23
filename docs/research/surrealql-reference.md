# SurrealQL Query Language

> **Comprehensive reference guide** for SurrealQL -- SurrealDB's multi-model query language that unifies document, graph, and relational paradigms into a single SQL-like syntax.

---

## Table of Contents

- [[#Overview]]
- [[#Data Manipulation Statements]]
  - [[#SELECT]]
  - [[#CREATE]]
  - [[#INSERT]]
  - [[#UPDATE]]
  - [[#UPSERT]]
  - [[#DELETE]]
  - [[#RELATE]]
- [[#Schema Definition Statements]]
  - [[#DEFINE NAMESPACE and DATABASE]]
  - [[#DEFINE TABLE]]
  - [[#DEFINE FIELD]]
  - [[#DEFINE INDEX]]
  - [[#DEFINE EVENT]]
  - [[#DEFINE FUNCTION]]
  - [[#DEFINE PARAM]]
  - [[#DEFINE ACCESS]]
  - [[#DEFINE ANALYZER]]
  - [[#DEFINE USER]]
  - [[#DEFINE API]]
- [[#Control Flow]]
  - [[#IF ELSE]]
  - [[#FOR Loops]]
  - [[#BREAK and CONTINUE]]
  - [[#RETURN]]
  - [[#THROW]]
- [[#Transactions]]
- [[#Variables and Parameters]]
- [[#Graph Traversal]]
- [[#Record IDs]]
- [[#Record Links and References]]
- [[#Subqueries]]
- [[#Idioms -- Dot and Bracket Notation]]
- [[#Operators]]
- [[#Type System and Casting]]
- [[#Futures and Computed Fields]]
- [[#Closures and Anonymous Functions]]
- [[#Built-in Functions]]
- [[#Live Queries]]
- [[#Utility Statements]]
- [[#Comments]]

---

## Overview

SurrealQL is a SQL-like query language designed specifically for SurrealDB. While it shares familiar syntax with traditional SQL, it introduces key differences:

- **No JOINs needed** -- record links and graph edges replace traditional joins
- **Multi-model in one language** -- documents, graphs, and relational data all use the same syntax
- **Graph traversal** with arrow operators (`->`, `<-`, `<->`)
- **Inline subqueries** anywhere an expression is accepted
- **Strong typing** with optional schema enforcement
- **Built-in futures and computed fields** for derived values
- **Real-time subscriptions** via `LIVE SELECT`
- **JavaScript/WASM embedded functions** for complex logic

All queries are executed within implicit transactions. Multiple statements can also be wrapped in explicit `BEGIN`/`COMMIT` blocks.

---

## Data Manipulation Statements

### SELECT

The primary data retrieval statement. Returns an array of objects (records) by default.

**Full syntax:**
```surql
SELECT [VALUE] @fields [AS @alias] [OMIT @fields]
  FROM [ONLY] @targets
  [WITH [NOINDEX | INDEX @indexes]]
  [WHERE @conditions]
  [SPLIT [ON] @field, ...]
  [GROUP [ALL | [BY] @field, ...]]
  [ORDER [BY] RAND() | @field [COLLATE] [NUMERIC] [ASC | DESC], ...]
  [LIMIT [BY] @limit]
  [START [AT] @start]
  [FETCH @fields ...]
  [TIMEOUT @duration]
  [TEMPFILES]
  [EXPLAIN [FULL]];
```

**Basic queries:**
```surql
-- Select all fields from a table
SELECT * FROM person;

-- Select specific fields
SELECT name, age FROM person;

-- Select from a specific record
SELECT * FROM person:tobie;

-- Select a single value (returns flat array instead of array of objects)
SELECT VALUE name FROM person;

-- Omit certain fields
SELECT * OMIT password, secret FROM user;

-- Alias fields
SELECT name, (age + 1) AS age_next_year FROM person;

-- Select from multiple tables
SELECT * FROM article, post WHERE title CONTAINS 'SurrealDB';
```

**ONLY keyword** -- expects exactly one result, returns object instead of array:
```surql
SELECT * FROM ONLY person:tobie;
-- Returns { id: person:tobie, name: "Tobie", ... }
-- Instead of [{ id: person:tobie, name: "Tobie", ... }]
```

**WHERE clause:**
```surql
SELECT * FROM person WHERE age >= 18 AND age <= 65;
-- Equivalent using range syntax:
SELECT * FROM person WHERE age IN 18..=65;

-- Pattern matching
SELECT * FROM person WHERE emails..value ?= /gmail.com$/;

-- Nested field access
SELECT * FROM person WHERE address.city = 'London';
```

**GROUP BY and GROUP ALL:**
```surql
-- Group with aggregates
SELECT count() AS total, country
  FROM person
  GROUP BY country;

-- Group ALL (aggregate entire table)
SELECT count() AS total, math::mean(age) AS avg_age
  FROM person
  GROUP ALL;
```

**ORDER BY:**
```surql
SELECT * FROM person ORDER BY age DESC;
SELECT * FROM person ORDER BY RAND();  -- random order
SELECT * FROM person ORDER BY name COLLATE ASC;  -- locale-aware sorting
SELECT * FROM person ORDER BY age NUMERIC DESC;
```

**LIMIT and START (pagination):**
```surql
SELECT * FROM person LIMIT 10;
SELECT * FROM person LIMIT 10 START 20;  -- skip first 20
```

**SPLIT -- flatten arrays into separate records:**
```surql
SELECT * FROM person SPLIT emails;
-- Each email becomes its own result row
```

**FETCH -- eagerly resolve record links:**
```surql
SELECT * FROM post FETCH author, comments;
-- `author` and `comments` record links are resolved to full objects
```

**TIMEOUT:**
```surql
SELECT * FROM person WHERE ->knows->person TIMEOUT 5s;
```

**EXPLAIN -- view query execution plan:**
```surql
SELECT * FROM person WHERE age > 30 EXPLAIN;
SELECT * FROM person WHERE age > 30 EXPLAIN FULL;  -- includes row counts
```

**WITH -- index hints:**
```surql
SELECT * FROM person WITH INDEX age_idx WHERE age > 30;
SELECT * FROM person WITH NOINDEX WHERE age > 30;  -- force table scan
```

**Record ranges:**
```surql
-- Select a range of records by ID
SELECT * FROM person:1..=100;
SELECT * FROM temperature:['London', NONE]..=['London', ..];
```

---

### CREATE

Creates new records. Generates an ID if not specified.

```surql
-- Auto-generated ID
CREATE person SET name = 'Tobie', age = 35;

-- Specific ID
CREATE person:tobie SET name = 'Tobie', age = 35;

-- Generated ID types
CREATE person:rand() SET name = 'Random';
CREATE person:ulid() SET name = 'ULID-based';
CREATE person:uuid() SET name = 'UUID-based';

-- Using CONTENT (full object)
CREATE person CONTENT {
    name: { first: 'Tobie', last: 'Morgan Hitchcock' },
    age: 35,
    tags: ['founder', 'developer']
};

-- Create multiple records at once
CREATE |person:10| SET name = "Person " + <string>id.id();

-- RETURN clause
CREATE person SET name = 'Tobie' RETURN id;
CREATE person SET name = 'Tobie' RETURN NONE;
CREATE person SET name = 'Tobie' RETURN BEFORE;
CREATE person SET name = 'Tobie' RETURN AFTER;
CREATE person SET name = 'Tobie' RETURN DIFF;

-- ONLY -- return single object instead of array
CREATE ONLY person:tobie SET name = 'Tobie';

-- TIMEOUT
CREATE person 500000 SET age = 25 TIMEOUT 500ms;
```

---

### INSERT

SQL-like insert supporting `ON DUPLICATE KEY UPDATE`.

```surql
-- Single record
INSERT INTO person { name: 'Tobie', age: 35 };

-- Multiple records
INSERT INTO person [
    { name: 'Tobie', age: 35 },
    { name: 'Jaime', age: 30 }
];

-- VALUES syntax
INSERT INTO city (id, population, at_year)
VALUES
    ("Calgary", 1665000, 2024);

-- ON DUPLICATE KEY UPDATE (upsert behavior)
INSERT INTO city (id, population, at_year)
VALUES ("Calgary", 1700000, 2025)
ON DUPLICATE KEY UPDATE
    population = $input.population,
    at_year = $input.at_year;

-- With unique index conflict
DEFINE FIELD data_for ON user_data TYPE record<user>;
DEFINE INDEX one_user ON user_data FIELDS data_for UNIQUE;

INSERT INTO user_data { data_for: user:one, some: "data" }
ON DUPLICATE KEY UPDATE
    times_updated += 1,
    last_edited = time::now();
```

---

### UPDATE

Modifies existing records. Does NOT create records if they do not exist (as of v2.0+).

```surql
-- Update all records in a table
UPDATE person SET active = true;

-- Update specific record
UPDATE person:tobie SET age = 36;

-- SET individual fields
UPDATE person:tobie SET
    name.first = 'Tobie',
    name.last = 'Morgan Hitchcock',
    tags += 'admin';

-- CONTENT -- replace entire record content (except id)
UPDATE person:tobie CONTENT {
    name: 'Tobie',
    age: 36
};

-- MERGE -- merge fields into existing record
UPDATE person:tobie MERGE {
    settings: { theme: 'dark' }
};

-- REPLACE -- replace entire record
UPDATE person:tobie REPLACE {
    name: 'Tobie',
    age: 36
};

-- PATCH -- JSON Patch operations
UPDATE person:tobie PATCH [
    { op: "replace", path: "/age", value: 37 },
    { op: "add", path: "/email", value: "tobie@surrealdb.com" }
];

-- Conditional updates
UPDATE person SET important = true
  WHERE ->knows->person->(knows WHERE influencer = true)
  TIMEOUT 5s;

-- RETURN clause
UPDATE person:tobie SET age = 37 RETURN DIFF;
UPDATE person:tobie SET age = 37 RETURN BEFORE;
UPDATE person:tobie SET age = 37 RETURN AFTER;

-- Increment and decrement operators
UPDATE counter:hits SET count += 1;
UPDATE counter:hits SET count -= 1;

-- Append to array
UPDATE person:tobie SET tags += 'new_tag';
-- Conditional append (only if not already present)
UPDATE person:tobie SET tags +?= 'unique_tag';
```

---

### UPSERT

Insert if not exists, update if it does. Combines CREATE and UPDATE semantics.

```surql
-- Basic upsert
UPSERT person:tobie SET name = 'Tobie', age = 35;

-- Conditional append with state inspection
UPSERT person:test SET sport +?= 'tennis' RETURN sport;

-- CONTENT syntax
UPSERT person:tobie CONTENT {
    name: 'Tobie',
    age: 35
};

-- MERGE syntax
UPSERT person:tobie MERGE { settings: { theme: 'dark' } };
```

---

### DELETE

Removes records from tables.

```surql
-- Delete a specific record
DELETE person:tobie;

-- Delete all records in a table
DELETE person;

-- Conditional delete
DELETE comment WHERE spam = true;

-- RETURN deleted records
DELETE person:tobie RETURN BEFORE;

-- ONLY -- expect single record
DELETE ONLY person:tobie;

-- With timeout
DELETE person WHERE inactive = true TIMEOUT 5s;
```

---

### RELATE

Creates graph edges (relationships) between records. Edges are full records stored in their own table.

**Syntax:**
```surql
RELATE [ONLY] @from -> @edge_table -> @to
  [CONTENT @value | SET @field = @value ...]
  [RETURN ...]
  [TIMEOUT @duration];
```

**Examples:**
```surql
-- Basic relation
RELATE user:tobie->write->article:surreal
  SET time.written = time::now();

-- With variables (relate multiple records)
LET $from = (SELECT users FROM company:surrealdb);
LET $devs = (SELECT * FROM user WHERE tags CONTAINS 'developer');
RELATE $from->like->$devs UNIQUE
  SET time.connected = time::now();

-- Relate to multiple targets
RELATE person:one->wrote->[blog:one, book:one, comment:one];

-- With CONTENT
RELATE user:tobie->purchased->product:laptop CONTENT {
    quantity: 2,
    price: 999.99,
    date: time::now()
};

-- Prevent duplicate relations with UNIQUE
DEFINE FIELD key ON TABLE follows
  VALUE <string>array::sort([in, out]);
DEFINE INDEX unique_follow ON TABLE follows FIELDS key UNIQUE;
```

---

## Schema Definition Statements

### DEFINE NAMESPACE and DATABASE

```surql
DEFINE NAMESPACE my_namespace COMMENT 'Production namespace';
DEFINE DATABASE my_database COMMENT 'Main app database' CHANGEFEED 10m;
```

---

### DEFINE TABLE

```surql
-- Basic schemaless table
DEFINE TABLE person SCHEMALESS;

-- Strict schema table
DEFINE TABLE user SCHEMAFULL;

-- IF NOT EXISTS / OVERWRITE
DEFINE TABLE IF NOT EXISTS user SCHEMAFULL;
DEFINE TABLE OVERWRITE user SCHEMAFULL;

-- DROP table (accept writes but discard data -- useful for event triggers)
DEFINE TABLE reading DROP;

-- Relation table (graph edge)
DEFINE TABLE wrote TYPE RELATION FROM person TO article SCHEMAFULL;
DEFINE TABLE wishlist TYPE RELATION FROM person TO product SCHEMAFULL;

-- Table with changefeed
DEFINE TABLE order CHANGEFEED 7d INCLUDE ORIGINAL;

-- Table with permissions
DEFINE TABLE post SCHEMAFULL
  PERMISSIONS
    FOR SELECT FULL
    FOR CREATE WHERE $auth.id != NONE
    FOR UPDATE WHERE author = $auth.id
    FOR DELETE WHERE author = $auth.id OR $auth.admin = true;

-- Table as a VIEW (computed aggregate table)
DEFINE TABLE monthly_sales TYPE NORMAL SCHEMAFULL AS
  SELECT
    count() AS number_of_orders,
    time::format(time.created_at, '%Y-%m') AS month,
    math::sum(price * quantity) AS sum_sales,
    currency
  FROM order
  GROUP BY month, currency;

-- Aggregate view (e.g. for time-series)
DEFINE TABLE temperatures_by_month AS
  SELECT
    count() AS total,
    time::month(recorded_at) AS month,
    math::mean(temperature) AS average_temp
  FROM reading
  GROUP BY city;
```

---

### DEFINE FIELD

```surql
-- Basic field definition
DEFINE FIELD name ON TABLE user TYPE string;

-- Nested field
DEFINE FIELD name.first ON TABLE user TYPE string;
DEFINE FIELD name.last ON TABLE user TYPE string;

-- Optional field
DEFINE FIELD age ON person TYPE option<number>;

-- Record link field
DEFINE FIELD author ON book TYPE record<person>;
DEFINE FIELD pet ON user TYPE option<record<cat | dog>>;

-- Union types
DEFINE FIELD rating ON film TYPE float | decimal;

-- Typed arrays and sets
DEFINE FIELD tags ON person TYPE set<string, 5>;
DEFINE FIELD friends ON person TYPE array<record<person>>;

-- DEFAULT value
DEFINE FIELD created_at ON TABLE user TYPE datetime DEFAULT time::now();
-- DEFAULT ALWAYS (overrides any provided value)
DEFINE FIELD updated_at ON TABLE user TYPE datetime DEFAULT ALWAYS time::now();

-- VALUE clause (computed on write)
DEFINE FIELD updated_at ON TABLE address TYPE datetime VALUE time::now();
DEFINE FIELD countrycode ON user TYPE string
  VALUE $value OR $before OR 'GBR';

-- ASSERT (validation constraint)
DEFINE FIELD email ON TABLE user TYPE string
  ASSERT string::is_email($value);
DEFINE FIELD countrycode ON user TYPE string
  ASSERT $value = /[A-Z]{3}/;

-- READONLY (immutable after creation)
DEFINE FIELD created_at ON user TYPE datetime
  DEFAULT time::now() READONLY;

-- FLEXIBLE type (allows any data matching the base type)
DEFINE FIELD metadata ON TABLE event TYPE object FLEXIBLE;

-- REFERENCE (for record links with referential integrity)
DEFINE FIELD author ON comment TYPE record<person>
  REFERENCE ON DELETE CASCADE;
DEFINE FIELD comics ON person TYPE option<array<record<comic_book>>>
  REFERENCE;

-- COMPUTED field (calculated on every access, not stored)
DEFINE FIELD can_drive ON person
  COMPUTED time::now() - born > 18y;
DEFINE FIELD valid ON license
  COMPUTED time::now() - since < 2y;
DEFINE FIELD licenses ON person
  COMPUTED <~license;

-- COMPUTED with reverse reference lookup
DEFINE FIELD owned_by ON comic_book
  COMPUTED <~(person FIELD comics);
DEFINE FIELD borrowed_by ON comic_book
  COMPUTED <~(person FIELD borrowed_comics);

-- OVERWRITE / IF NOT EXISTS
DEFINE FIELD OVERWRITE email ON TABLE user TYPE string;
DEFINE FIELD IF NOT EXISTS email ON TABLE user TYPE string;

-- Permissions on fields
DEFINE FIELD secret ON TABLE user TYPE string
  PERMISSIONS
    FOR SELECT WHERE id = $auth.id
    FOR UPDATE NONE;
```

---

### DEFINE INDEX

```surql
-- Standard index
DEFINE INDEX age_idx ON TABLE person FIELDS age;

-- Unique index
DEFINE INDEX email ON TABLE user COLUMNS email UNIQUE;

-- Composite unique index
DEFINE INDEX name_idx ON TABLE user FIELDS first_name, last_name UNIQUE;

-- Full-text search index
DEFINE INDEX search_title ON book COLUMNS title
  SEARCH ANALYZER en BM25 HIGHLIGHTS;

-- Full-text with custom analyzer
DEFINE ANALYZER blank_snowball
  TOKENIZERS blank
  FILTERS snowball(english);
DEFINE INDEX review_content ON TABLE review
  FIELDS review_text
  FULLTEXT ANALYZER blank_snowball BM25 HIGHLIGHTS;

-- MTREE vector index (for similarity search)
DEFINE INDEX mt_obj ON vec FIELDS embedding
  MTREE DIMENSION 4 DIST EUCLIDEAN;

-- HNSW vector index (advanced vector search)
DEFINE INDEX hnsw_idx ON TABLE article FIELDS embedding
  HNSW DIMENSION 128
  EFC 250
  TYPE F32
  DISTANCE MANHATTAN
  M 6 M0 12 LM 0.5
  EXTEND_CANDIDATES
  KEEP_PRUNED_CONNECTIONS;

-- Build index concurrently (non-blocking)
DEFINE INDEX email ON TABLE user FIELDS email UNIQUE CONCURRENTLY;
```

---

### DEFINE EVENT

Triggers that fire when records change.

```surql
-- Basic event on field change
DEFINE EVENT email ON TABLE user
  WHEN $before.email != $after.email
  THEN (
    CREATE event SET
      user = $this,
      time = time::now(),
      value = $after.email,
      action = 'email_changed'
  );

-- Event on create
DEFINE EVENT payment ON TABLE order
  WHEN $event = 'CREATE'
  THEN http::post($STRIPE, $value);

-- Event with complex logic
DEFINE EVENT comment_added ON TABLE comment
  WHEN $event = 'CREATE'
  THEN {
    -- Increment comment count
    UPDATE $after.post SET comment_count += 1;
    -- Notify the post author
    CREATE notification SET
      recipient = $after.post.author,
      type = 'new_comment',
      comment = $after.id;
  };
```

Available event variables: `$before`, `$after`, `$value`, `$this`, `$event` (CREATE/UPDATE/DELETE).

---

### DEFINE FUNCTION

Custom reusable functions.

```surql
-- Simple function
DEFINE FUNCTION fn::greet($name: string) {
    RETURN "Hello, " + $name + "!";
};

-- Namespaced function
DEFINE FUNCTION fn::my::custom::lowercase($name: string) {
    RETURN string::lowercase($name);
};

-- Function with multiple parameters
DEFINE FUNCTION fn::calculate_total($price: float, $quantity: int, $tax_rate: float) {
    LET $subtotal = $price * $quantity;
    RETURN $subtotal + ($subtotal * $tax_rate);
};

-- Usage
RETURN fn::greet("Tobie");
-- "Hello, Tobie!"

SELECT *, fn::calculate_total(price, quantity, 0.2) AS total FROM order;
```

---

### DEFINE PARAM

Global parameters accessible in all queries.

```surql
DEFINE PARAM $STRIPE VALUE "https://api.stripe.com/payments/new";
DEFINE PARAM $MAX_RETRIES VALUE 3;
DEFINE PARAM $DEFAULT_LANG VALUE "en";

-- Used in queries
DEFINE EVENT payment ON TABLE order
  WHEN $event = 'CREATE'
  THEN http::post($STRIPE, $value);
```

---

### DEFINE ACCESS

Authentication and authorization methods.

```surql
-- Record access (for application users)
DEFINE ACCESS user_access ON DATABASE TYPE RECORD
  SIGNUP (
    CREATE user SET
      email = $email,
      pass = crypto::argon2::generate($pass)
  )
  SIGNIN (
    SELECT * FROM user WHERE
      email = $email AND
      crypto::argon2::compare(pass, $pass)
  )
  DURATION FOR SESSION 24h;

-- JWT access (external token verification)
DEFINE ACCESS api_access ON DATABASE TYPE JWT
  ALGORITHM RS256
  KEY "-----BEGIN PUBLIC KEY-----...-----END PUBLIC KEY-----";

-- JWT with JWKS URL
DEFINE ACCESS oauth ON DATABASE TYPE JWT
  URL "https://auth.example.com/.well-known/jwks.json";

-- Bearer access
DEFINE ACCESS service_access ON DATABASE TYPE BEARER FOR USER
  DURATION FOR GRANT 30d FOR TOKEN 1h FOR SESSION 24h;
```

---

### DEFINE ANALYZER

Text analyzers for full-text search.

```surql
-- English analyzer with snowball stemming
DEFINE ANALYZER en
  TOKENIZERS camel, class
  FILTERS snowball(english);

-- Blank tokenizer with snowball
DEFINE ANALYZER blank_snowball
  TOKENIZERS blank
  FILTERS snowball(english);

-- Custom analyzer with multiple filters
DEFINE ANALYZER custom_analyzer
  TOKENIZERS blank, class, camel
  FILTERS ascii, lowercase, snowball(english);
```

---

### DEFINE USER

System users for database administration.

```surql
DEFINE USER admin ON DATABASE PASSWORD 'secure_password' ROLES OWNER;
DEFINE USER readonly ON DATABASE PASSWORD 'read_pass' ROLES VIEWER;
DEFINE USER editor ON NAMESPACE PASSWORD 'ns_pass' ROLES EDITOR;
```

---

### DEFINE API

Define HTTP API endpoints (available since v2.2.0).

```surql
DEFINE API "/hello" METHOD GET HANDLER {
    RETURN "Hello, World!";
};

DEFINE API "/users/:id" METHOD GET HANDLER {
    RETURN SELECT * FROM ONLY type::thing("user", $id);
};
```

---

## Control Flow

### IF ELSE

```surql
-- Basic if/else
IF $age >= 18 THEN
    "Adult"
ELSE IF $age >= 13 THEN
    "Teenager"
ELSE
    "Child"
END;

-- If/else with statements
IF $record.count THEN
    (UPSERT person:test SET sport +?= 'football' RETURN sport)
ELSE
    (UPSERT person:test SET sport = ['basketball'] RETURN sport)
END;

-- Inline ternary-style
LET $status = IF active THEN "active" ELSE "inactive" END;
```

---

### FOR Loops

```surql
-- Basic iteration
FOR $item IN [1, 2, 3] {
    CREATE number SET value = $item;
};

-- Iterate over query results
FOR $person IN (SELECT * FROM person WHERE age > 18) {
    UPDATE $person.id SET verified = true;
};

-- With expressions
FOR $item IN (SELECT foo FROM bar) * 2 {
    RETURN $item;
};
```

---

### BREAK and CONTINUE

```surql
FOR $item IN [1, 2, 3, 4, 5] {
    IF $item = 3 {
        CONTINUE;  -- skip this iteration
    };
    IF $item = 5 {
        BREAK;  -- exit loop
    };
    CREATE number SET value = $item;
};
```

---

### RETURN

```surql
RETURN 42;
RETURN "Hello";
RETURN $record;
RETURN (SELECT age >= 18 AS adult FROM person);
RETURN { key: "value", list: [1, 2, 3] };
RETURN array::len([1, 2, 3]);
```

---

### THROW

```surql
-- Throw a simple error
THROW 'Something went wrong';

-- Conditional throw
IF $balance < 0 {
    THROW 'Insufficient funds';
};

-- Throw with dynamic message
THROW 'User ' + <string>$user.id + ' not authorized';
```

---

## Transactions

All statements in SurrealDB run within implicit transactions. You can also create explicit multi-statement transactions.

```surql
-- Explicit transaction
BEGIN;
CREATE account:one SET balance = 1000;
CREATE account:two SET balance = 500;
UPDATE account:one SET balance -= 100;
UPDATE account:two SET balance += 100;
COMMIT;

-- Cancel a transaction (rollback)
BEGIN;
CREATE thing:test SET value = 1;
-- Something went wrong...
CANCEL;
-- Nothing was committed

-- Transactions are ACID: if any statement fails, all roll back
BEGIN;
CREATE thing:success;
CREATE thing:fail SET bad = rand('evil');  -- will error
CREATE thing:also_success;
COMMIT;
-- None of the above records will exist
```

---

## Variables and Parameters

### LET -- local variables

```surql
LET $name = 'Tobie';
LET $adults = (SELECT * FROM person WHERE age >= 18);
LET $now = time::now();

SELECT * FROM person WHERE name = $name;
```

### System variables

| Variable | Description |
|----------|-------------|
| `$this` | The current record |
| `$parent` | Parent record (in subqueries) |
| `$auth` | The authenticated user/record |
| `$token` | JWT token claims |
| `$session` | Session information |
| `$before` | Record before modification (in events/permissions) |
| `$after` | Record after modification (in events/permissions) |
| `$value` | The current field value (in DEFINE FIELD) |
| `$input` | The input value (in ON DUPLICATE KEY UPDATE) |
| `$event` | The event type: CREATE, UPDATE, DELETE |

### DEFINE PARAM -- global parameters

```surql
DEFINE PARAM $API_URL VALUE "https://api.example.com";
-- Available across all queries in the database
```

---

## Graph Traversal

SurrealQL uses arrow operators to traverse graph edges without explicit JOINs.

### Arrow operators

| Operator | Direction | Meaning |
|----------|-----------|---------|
| `->` | Outgoing | Follow edges going out |
| `<-` | Incoming | Follow edges coming in |
| `<->` | Both | Follow edges in either direction |

### Basic traversal

```surql
-- Who did Tobie write?
SELECT ->write->article FROM person:tobie;

-- Who wrote this article? (reverse traversal)
SELECT <-write<-person FROM article:surreal;

-- Multi-hop traversal
SELECT ->knows->person->knows->person FROM person:tobie;

-- Traverse without SELECT
person:tobie->write->article;
person:tobie->likes->cat;
```

### Filtering during traversal

```surql
-- Filter on edge properties
SELECT ->purchased->(? WHERE quantity > 1)->product FROM person:tobie;

-- Filter on target properties
SELECT ->knows->person->(? WHERE age > 30) FROM person:tobie;

-- Named bindings in traversal
SELECT
    ->knows->(? AS f1)
    ->knows->(? AS f2)
    ->(knows, likes AS e3 WHERE influencer = true)
    ->(? AS f3)
FROM person:tobie;
```

### Bidirectional queries

```surql
-- Find sister cities (bidirectional relation)
SELECT <->sister_city<->city AS sisters FROM city:calgary;

-- Find all relations of any type
SELECT <->(?) AS all_relations FROM person:tobie;

-- Complement -- find cities that are sisters to others but not to self
SELECT array::complement(<->sister_city<->city, [id]) AS sister_cities
FROM city;
```

### Traversal from edge tables

```surql
-- Access fields during traversal
SELECT
    ->purchased.price AS price,
    ->purchased->product.name AS product_name,
    ->purchased.quantity AS quantity
FROM person:tobie;
```

### Recursive and deep traversal

```surql
-- All people connected up to 5 hops
SELECT ->knows->person FROM person:tobie;

-- Friends of friends
SELECT ->knows->person->knows->person AS fof FROM person:tobie;

-- Products purchased by people who know me
SELECT <-knows<-person->purchased->product FROM person:tobie;
```

---

## Record IDs

Every record in SurrealDB has a unique ID in the format `table:id`.

### ID generation

```surql
-- String ID
CREATE person:tobie;

-- Numeric ID
CREATE person:13059;

-- Random ID (auto-generated)
CREATE person;

-- Explicit random generators
CREATE person:rand();    -- random string
CREATE person:ulid();    -- ULID (time-sortable)
CREATE person:uuid();    -- UUID v7

-- Complex / array-based IDs (for time-series, composite keys)
LET $now = time::now();
CREATE temperature:['London', $now] SET
    location = 'London',
    date = time::round($now, 1h),
    temperature = 23.7;

-- Object-based IDs
CREATE log:{ ts: time::now(), level: 'info' } SET message = 'Started';
```

### Record ID ranges

```surql
-- Range by numeric ID
SELECT * FROM person:1..=100;

-- Range by array-based ID
SELECT * FROM temperature:['London', NONE]..=['London', ..];
```

---

## Record Links and References

### Record links (direct pointers)

Record links are direct references from one record to another, stored as `table:id` values.

```surql
-- Create a record link
CREATE person:jaime SET friends = [person:tobie, person:simon];

-- Fetch linked data via dot notation
SELECT friends.name FROM person:jaime;

-- Deep traversal through links
SELECT friends.friends.friends.name FROM person:tobie;

-- Typed record link in schema
DEFINE FIELD author ON book TYPE record<person>;
DEFINE FIELD pet ON user TYPE option<record<cat | dog>>;
```

### Record references (with REFERENCE clause)

Available since v2.2.0. Enables reverse lookups and referential integrity.

```surql
-- Define a reference field
DEFINE FIELD author ON comment TYPE record<person>
  REFERENCE ON DELETE CASCADE;

-- Computed reverse lookup using <~ syntax
DEFINE FIELD comments ON person COMPUTED <~comment;

-- ON DELETE behaviors:
--   CASCADE   -- delete referencing records
--   REJECT    -- prevent deletion if references exist
--   IGNORE    -- silently leave dangling references
--   UNSET     -- set the field to NONE
--   THEN expr -- run custom logic

-- REFERENCE with custom ON DELETE
DEFINE FIELD comments ON person TYPE option<array<record<comment>>>
  REFERENCE ON DELETE THEN {
    UPDATE $this SET
      deleted_comments += $reference,
      comments -= $reference;
  };

-- Reverse lookup with field specification
DEFINE FIELD owned_by ON comic_book
  COMPUTED <~(person FIELD comics);
DEFINE FIELD borrowed_by ON comic_book
  COMPUTED <~(person FIELD borrowed_comics);
```

---

## Subqueries

Subqueries can appear anywhere an expression is accepted.

```surql
-- Subquery in RETURN
RETURN (SELECT age >= 18 AS adult FROM person);

-- Subquery in WHERE
SELECT * FROM (SELECT age >= 18 AS adult FROM person) WHERE adult = true;

-- Subquery in SET
CREATE report SET
    total_users = (SELECT VALUE count() FROM user GROUP ALL),
    active_users = (SELECT VALUE count() FROM user WHERE active = true GROUP ALL);

-- Subquery in RELATE
LET $from = (SELECT users FROM company:surrealdb);
RELATE $from->like->(SELECT * FROM user WHERE tags CONTAINS 'developer');

-- Nested subqueries
SELECT *,
    (SELECT VALUE count() FROM ->write->article GROUP ALL) AS article_count
FROM person;
```

---

## Idioms -- Dot and Bracket Notation

SurrealQL "idioms" provide path-based access to nested data.

### Dot notation

```surql
-- Access nested fields
SELECT address.city FROM person;
SELECT name.first FROM person;

-- Deep nesting
SELECT metadata.settings.theme FROM user;
```

### Array indexing

```surql
-- First element
SELECT tags[0] FROM person;

-- Last element
SELECT tags[$] FROM person;

-- Specific index
SELECT images[2].url FROM product;
```

### Wildcard access

```surql
-- All values from all images
SELECT images[*].url FROM product;
-- Or equivalently:
SELECT images..url FROM product;

-- All values of an object
{ a: 1, b: 2 }.*;
-- Returns [1, 2]
```

### Array filtering with WHERE

```surql
-- Filter within arrays
SELECT emails[WHERE active = true] FROM person;
SELECT tags[WHERE $value CONTAINS 'important'] FROM post;
```

### Conditional access

```surql
-- Optional chaining
SELECT address?.city FROM person;
```

---

## Operators

### Arithmetic

| Operator | Description |
|----------|-------------|
| `+` | Addition |
| `-` | Subtraction |
| `*` / `x` | Multiplication |
| `/` / `÷` | Division |
| `%` | Modulo |
| `**` | Power / Exponentiation |

### Comparison

| Operator | Description |
|----------|-------------|
| `=` / `==` | Equal |
| `!=` | Not equal |
| `<` | Less than |
| `<=` | Less than or equal |
| `>` | Greater than |
| `>=` | Greater than or equal |

### Exact equality vs. fuzzy matching

| Operator | Description |
|----------|-------------|
| `==` | Exact equality |
| `?=` | Any value in set equals (fuzzy) |
| `*=` | All values in set equal |
| `~` | Fuzzy match (all) |
| `?~` | Fuzzy match (any) |
| `*~` | Fuzzy match (all) |

### Logical

| Operator | Description |
|----------|-------------|
| `AND` / `&&` | Logical AND |
| `OR` / `\|\|` | Logical OR |
| `NOT` / `!` | Logical NOT |

### Nullish operators

| Operator | Description |
|----------|-------------|
| `??` | Nullish coalescing (returns right if left is NONE/NULL) |
| `?:` | Elvis operator (returns right if left is falsy) |

### Containment operators

| Operator | Unicode | Description |
|----------|---------|-------------|
| `CONTAINS` | `∋` | Value contains another value |
| `CONTAINSNOT` | `∌` | Value does not contain |
| `CONTAINSALL` | `⊇` | Contains all values |
| `CONTAINSANY` | `⊃` | Contains any value |
| `CONTAINSNONE` | `⊅` | Contains none of the values |
| `INSIDE` / `IN` | `∈` | Value is inside another |
| `NOTINSIDE` / `NOT IN` | `∉` | Value is not inside another |
| `ALLINSIDE` | `⊆` | All values are inside |
| `ANYINSIDE` | `⊂` | Any value is inside |
| `NONEINSIDE` | `⊄` | No values are inside |

```surql
-- Containment examples
SELECT * FROM person WHERE tags CONTAINSANY ["developer", "admin"];
SELECT * FROM person WHERE "admin" IN tags;
[1,2,3] CONTAINSALL [1,2];     -- true
[1,2] ALLINSIDE [1,2,3];       -- true
"Rumplestiltskin" CONTAINSALL ["umple", "kin"];  -- true
```

### Geospatial operators

| Operator | Description |
|----------|-------------|
| `OUTSIDE` | Geometry is outside another |
| `INTERSECTS` | Geometries intersect |
| `INSIDE` | Geometry is inside another |

```surql
SELECT * FROM restaurant WHERE location INSIDE {
    type: "Polygon",
    coordinates: [[...]]
};
```

### Full-text search operator

```surql
-- @N@ where N is the index reference number
SELECT search::score(1) AS score,
       search::highlight('<b>', '</b>', 1) AS title
FROM book
WHERE title @1@ 'rust web'
ORDER BY score DESC;
```

### Assignment operators (in SET clause)

| Operator | Description |
|----------|-------------|
| `=` | Set value |
| `+=` | Increment / append |
| `-=` | Decrement / remove |
| `+?=` | Append only if not present |

---

## Type System and Casting

### Core types

| Type | Description |
|------|-------------|
| `any` | Any value |
| `bool` | Boolean |
| `int` | 64-bit signed integer |
| `float` | 64-bit floating point |
| `decimal` | Arbitrary precision decimal |
| `number` | Generic numeric (int, float, or decimal) |
| `string` | Text |
| `datetime` | ISO-8601 date/time (stored as UTC) |
| `duration` | Time duration (ns to weeks) |
| `object` | Key-value map |
| `array` | Ordered collection |
| `set` | Unique ordered collection |
| `bytes` | Binary data |
| `uuid` | UUID |
| `record` | Record link (`record<table>`) |
| `geometry` | GeoJSON types |
| `option<T>` | Optional (T or NONE) |
| `file` | File reference (associated with a bucket) |

### Type casting

Use angle brackets `<type>` for explicit casts:

```surql
-- Cast to specific types
UPDATE person SET
    waist = <int> "34",
    height = <float> 201,
    score = <decimal> 0.3 + 0.3 + 0.3 + 0.1;

-- Cast in expressions
SELECT * FROM temperature WHERE (celsius * 1.8) + 32 > 86.0;

-- Datetime casting
<datetime> "2024-01-15T10:30:00Z";

-- Duration casting
<duration> "1h30m";

-- Boolean casting
<bool> "true";
<bool> 1;

-- Record ID casting
<record> "person:tobie";
```

### Type conversion functions

```surql
type::bool("true");          -- true
type::int("42");             -- 42
type::float("3.14");         -- 3.14
type::string(42);            -- "42"
type::datetime("2024-01-15");
type::array("test");         -- ["test"]
type::point([51.5, -0.1]);  -- geometry point

-- Method syntax
"42".to_int();
"true".to_bool();

-- Type checking
type::is_string("hello");   -- true
type::is_int(42);            -- true
type::is_array([1,2,3]);    -- true
"hello".is_string();         -- true (method syntax)
```

### NONE vs NULL

```surql
-- NONE: field does not exist / has no data
-- NULL: field exists but is explicitly empty/null

SELECT * FROM person WHERE email IS NONE;
SELECT * FROM person WHERE email IS NULL;
SELECT * FROM person WHERE email IS NOT NONE;
```

### Truthiness

Any value is falsy if it is `NONE`, `NULL`, or a "zero/empty" default:
- `0`, `0.0`, `0dec`
- `""` (empty string)
- `[]` (empty array)
- `{}` (empty object)
- `false`

Everything else is truthy.

---

## Futures and Computed Fields

### Futures (legacy, pre-3.0)

Futures are values computed at query time, not at write time. Stored as SurrealQL code.

```surql
-- Future syntax with <future> cast
UPDATE product SET
    name = "SurrealDB",
    launch_at = <datetime> "2021-11-01",
    countdown = <future> { launch_at - time::now() };

-- Future in field definition
DEFINE FIELD accessed_at ON TABLE user
  VALUE <future> { time::now() };

-- Future with subquery
DEFINE FIELD followers ON user
  VALUE <future> {
    (SELECT VALUE count FROM ONLY follower_count
     WHERE user = $parent.id LIMIT 1) ?? 0
  };
```

### Computed Fields (v3.0+, preferred)

Computed fields replace futures with cleaner syntax. They are not stored, but calculated on every access.

```surql
-- COMPUTED field syntax
DEFINE FIELD can_drive ON person
  COMPUTED time::now() - born > 18y;

DEFINE FIELD valid ON license
  COMPUTED time::now() - since < 2y;

-- COMPUTED with reverse reference
DEFINE FIELD licenses ON person
  COMPUTED <~license;

-- COMPUTED with subquery (no parentheses needed)
DEFINE FIELD random_movie ON app_screen
  COMPUTED SELECT * FROM ONLY movie ORDER BY RAND() LIMIT 1;

-- Comparison: future vs computed
-- Before (future):
DEFINE FIELD can_drive ON person VALUE <future> { time::now() - born > 18y };
-- After (computed):
DEFINE FIELD can_drive ON person COMPUTED time::now() - born > 18y;
```

**Key difference:** `VALUE` runs once on write and stores the result. `COMPUTED` runs on every read and is never stored. `<future>` in `VALUE` makes it behave like `COMPUTED` but with older syntax.

---

## Closures and Anonymous Functions

Available since v2.0.0. Closures are inline functions that can capture surrounding scope.

```surql
-- Closure syntax
LET $double = |$n: number| $n * 2;
RETURN $double(5);  -- 10

-- Closures in array operations
LET $numbers = [1, 2, 3, 4, 5];
RETURN $numbers.map(|$n| $n * 2);        -- [2, 4, 6, 8, 10]
RETURN $numbers.filter(|$n| $n > 3);     -- [4, 5]
RETURN $numbers.find(|$n| $n = 3);       -- 3

-- Array fold with closure
RETURN array::fold([1, 2, 3], 0, |$acc, $val| $acc + $val);  -- 6

-- Embedded JavaScript functions (for complex logic)
SELECT *, function() {
    return this.ratings.filter(r => r.rating >= 7)
        .map(r => ({ ...r, rating: r.rating * 10 }));
} AS featured FROM movie;
```

---

## Built-in Functions

SurrealQL includes an extensive function library. Functions use `module::function()` syntax or method syntax (`value.function()`).

### String functions

```surql
string::len("hello");             -- 5
string::lowercase("HELLO");       -- "hello"
string::uppercase("hello");       -- "HELLO"
string::capitalize("hello");      -- "Hello"
string::trim("  hello  ");        -- "hello"
string::contains("hello", "ell"); -- true
string::replace("hello", "l", "r"); -- "herro"
string::split("a,b,c", ",");     -- ["a", "b", "c"]
string::concat("hello", " ", "world"); -- "hello world"
string::starts_with("hello", "he"); -- true
string::ends_with("hello", "lo");   -- true
string::reverse("hello");         -- "olleh"
string::repeat("ha", 3);          -- "hahaha"
string::slug("Hello World!");     -- "hello-world"
string::is_email("a@b.com");     -- true

-- Method syntax
"hello".len();                    -- 5
"hello".uppercase();              -- "HELLO"
```

### Array functions

```surql
array::len([1, 2, 3]);           -- 3
array::first([1, 2, 3]);         -- 1
array::last([1, 2, 3]);          -- 3
array::distinct([1, 1, 2, 3]);   -- [1, 2, 3]
array::flatten([[1, 2], [3, 4]]); -- [1, 2, 3, 4]
array::sort([3, 1, 2]);          -- [1, 2, 3]
array::reverse([1, 2, 3]);       -- [3, 2, 1]
array::combine([1, 2], [3, 4]);  -- [[1,3],[1,4],[2,3],[2,4]]
array::intersect([1,2,3], [2,3,4]); -- [2, 3]
array::complement([1,2,3], [2]); -- [1, 3]
array::add([1, 2], 3);           -- [1, 2, 3] (only if not present)
array::append([1, 2], 3);        -- [1, 2, 3]
array::insert([1, 3], 2, 1);     -- [1, 2, 3]
array::join(["a", "b", "c"], ","); -- "a,b,c"
array::is_empty([]);              -- true
array::all([true, true]);         -- true
array::any([false, true]);        -- true
array::at([10, 20, 30], -1);     -- 30 (negative index)

-- Boolean operations on arrays
array::boolean_and([true, false], [true, true]);  -- [true, false]
array::boolean_or([true, false], [false, true]);   -- [true, true]
```

### Math functions

```surql
math::abs(-5);                    -- 5
math::ceil(4.2);                  -- 5
math::floor(4.8);                 -- 4
math::round(4.5);                 -- 5
math::pow(2, 10);                 -- 1024
math::sqrt(16);                   -- 4
math::log(100, 10);               -- 2
math::min([1, 2, 3]);             -- 1  (aggregate)
math::max([1, 2, 3]);             -- 3  (aggregate)
math::sum([1, 2, 3]);             -- 6  (aggregate)
math::mean([1, 2, 3, 4]);         -- 2.5 (aggregate)
math::median([1, 2, 3, 4, 5]);    -- 3  (aggregate)
math::stddev([1, 2, 3, 4, 5]);    -- standard deviation (aggregate)
math::variance([1, 2, 3, 4, 5]);  -- variance (aggregate)

-- Constants
math::PI;                         -- 3.14159...
math::E;                          -- 2.71828...
math::TAU;                        -- 6.28318...
math::SQRT_2;                     -- 1.41421...
```

### Time functions

```surql
time::now();                      -- current datetime
time::day(d"2024-06-15T12:00:00Z");   -- 15
time::month(d"2024-06-15T12:00:00Z"); -- 6
time::year(d"2024-06-15T12:00:00Z");  -- 2024
time::hour(d"2024-06-15T12:30:00Z");  -- 12
time::minute(d"2024-06-15T12:30:00Z"); -- 30
time::round(time::now(), 1h);    -- round to nearest hour
time::format(time::now(), '%Y-%m-%d'); -- "2024-06-15"
time::max(d"2024-01-01", d"2024-06-15"); -- aggregate max
time::min(d"2024-01-01", d"2024-06-15"); -- aggregate min
```

### Crypto functions

```surql
crypto::argon2::generate("password");
crypto::argon2::compare(hash, "password");
crypto::bcrypt::generate("password");
crypto::bcrypt::compare(hash, "password");
crypto::md5("data");
crypto::sha1("data");
crypto::sha256("data");
crypto::sha512("data");
```

### Geo functions

```surql
geo::distance((-0.04, 51.55), (30.46, -17.86));
geo::area({type: "Polygon", coordinates: [[...]]});
geo::bearing((0, 0), (1, 1));
geo::centroid({type: "Polygon", coordinates: [[...]]});
```

### HTTP functions

```surql
http::get("https://api.example.com/data");
http::post("https://api.example.com/data", { key: "value" });
http::put("https://api.example.com/data/1", { key: "new_value" });
http::patch("https://api.example.com/data/1", { key: "updated" });
http::delete("https://api.example.com/data/1");
http::head("https://api.example.com/data");
```

### Count function

```surql
-- Count all records
SELECT count() FROM person GROUP ALL;

-- Count with condition
SELECT count(age > 18) AS adults FROM person GROUP ALL;

-- Count in views
DEFINE TABLE user_stats AS
  SELECT count() AS total FROM user GROUP ALL;
```

### Rand functions

```surql
rand();                           -- random float 0..1
rand::bool();                     -- random boolean
rand::int();                      -- random integer
rand::int(1, 100);                -- random int in range
rand::float(0.0, 1.0);           -- random float in range
rand::string();                   -- random string
rand::string(15);                 -- random string of length 15
rand::string(10, 15);             -- random string, length 10-15
rand::uuid();                     -- random UUID
rand::uuid::v4();                 -- UUID v4
rand::ulid();                     -- random ULID
rand::enum("red", "green", "blue"); -- random pick
rand::time();                     -- random datetime
rand::duration();                 -- random duration
```

### Object functions

```surql
object::entries({ a: 1, b: 2 });  -- [["a", 1], ["b", 2]]
object::from_entries([["a", 1]]); -- { a: 1 }
object::keys({ a: 1, b: 2 });     -- ["a", "b"]
object::values({ a: 1, b: 2 });   -- [1, 2]
object::len({ a: 1, b: 2 });      -- 2
```

### Record functions

```surql
record::id(person:tobie);        -- "tobie"
record::table(person:tobie);     -- "person"
record::exists(person:tobie);    -- true/false
```

### Search functions (full-text)

```surql
search::score(1);                 -- relevance score for index ref 1
search::highlight('<b>', '</b>', 1); -- highlighted match
search::offsets(1);               -- match offsets
```

### Session functions

```surql
session::db();                    -- current database
session::ns();                    -- current namespace
session::origin();                -- request origin
session::ip();                    -- client IP
session::id();                    -- session ID
```

### Duration functions

```surql
duration::days(90h30m);           -- days component
duration::hours(90h30m);          -- hours component
duration::mins(90h30m);           -- minutes component
duration::secs(90h30m);           -- seconds component
```

### Encoding functions

```surql
encoding::base64::encode("hello");
encoding::base64::decode("aGVsbG8");
```

### Vector functions

```surql
vector::add([1,2,3], [4,5,6]);
vector::subtract([4,5,6], [1,2,3]);
vector::multiply([1,2,3], [4,5,6]);
vector::divide([4,6,8], [2,3,4]);
vector::magnitude([3,4]);                    -- 5
vector::normalize([3,4]);                    -- [0.6, 0.8]
vector::dot([1,2,3], [4,5,6]);              -- 32
vector::cross([1,0,0], [0,1,0]);            -- [0,0,1]
vector::distance::euclidean([0,0], [3,4]);  -- 5
vector::distance::cosine([1,0], [0,1]);
vector::similarity::cosine([1,2], [2,4]);
```

---

## Live Queries

Subscribe to real-time changes. Requires WebSocket connection.

```surql
-- Subscribe to all changes on a table
LIVE SELECT * FROM person;

-- Subscribe to a specific record
LIVE SELECT * FROM post:c569rth77ad48tc6s3ig;

-- With filtering
LIVE SELECT * FROM document
  WHERE account = $auth.account OR public = true;

-- DIFF mode (only changesets, not full documents)
LIVE SELECT DIFF FROM person;

-- Kill a live query
KILL "1986cc4e-340a-467d-9290-de81583267a2";
```

Live queries use the DIFF-MATCH-PATCH algorithm for efficient changeset delivery.

---

## Utility Statements

### USE

Switch namespace and database context.

```surql
USE NS production DB app_main;
USE NS test DB test_db;
```

### INFO

Introspect database structure.

```surql
INFO FOR ROOT;
INFO FOR NAMESPACE;
INFO FOR DATABASE;
INFO FOR TABLE person;
INFO FOR USER admin ON DATABASE;
```

### SLEEP

Pause execution (useful in testing).

```surql
SLEEP 1s;
SLEEP 500ms;
```

### REBUILD

Rebuild indexes.

```surql
REBUILD INDEX email ON TABLE user;
```

### REMOVE

Remove schema definitions.

```surql
REMOVE TABLE person;
REMOVE FIELD email ON TABLE user;
REMOVE INDEX email ON TABLE user;
REMOVE EVENT email ON TABLE user;
REMOVE FUNCTION fn::greet;
REMOVE PARAM $API_URL;
REMOVE ACCESS user_access ON DATABASE;
REMOVE USER admin ON DATABASE;
REMOVE NAMESPACE test;
REMOVE DATABASE test_db;
```

### SHOW

Show changefeed changes.

```surql
SHOW CHANGES FOR TABLE order SINCE d"2024-01-01T00:00:00Z";
```

---

## Comments

```surql
-- Single line comment (SQL style)

// Single line comment (C style)

/* Multi-line
   block comment */

# Hash comment (also supported)
```

---

## Quick Reference: Statement Cheat Sheet

| Statement | Purpose |
|-----------|---------|
| `SELECT` | Read data |
| `CREATE` | Create new records |
| `INSERT` | Insert (SQL-style, supports ON DUPLICATE KEY) |
| `UPDATE` | Modify existing records |
| `UPSERT` | Create or update |
| `DELETE` | Remove records |
| `RELATE` | Create graph edges |
| `DEFINE` | Define schema (tables, fields, indexes, events, functions, etc.) |
| `REMOVE` | Remove schema definitions |
| `LET` | Declare local variables |
| `RETURN` | Return a value |
| `IF/ELSE` | Conditional logic |
| `FOR` | Loop iteration |
| `BREAK` | Exit loop |
| `CONTINUE` | Skip to next iteration |
| `THROW` | Raise an error |
| `BEGIN` | Start transaction |
| `COMMIT` | Commit transaction |
| `CANCEL` | Rollback transaction |
| `LIVE SELECT` | Real-time subscription |
| `KILL` | Stop live query |
| `USE` | Switch namespace/database |
| `INFO` | Introspect structure |
| `SLEEP` | Pause execution |
| `SHOW` | View changefeed |
| `REBUILD` | Rebuild indexes |

---

*Research compiled: 2026-02-23. Sources: SurrealDB official documentation (surrealdb.com/docs), DeepWiki analysis of surrealdb/surrealdb repository, SurrealDB features page, SurrealDB blog posts.*
