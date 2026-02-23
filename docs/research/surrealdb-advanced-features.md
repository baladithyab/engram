# SurrealDB Advanced Features: Functions, Indexes & Analyzers

> Research date: 2026-02-23
> Covers: SurrealDB 2.x through 3.0 GA

---

## Table of Contents

- [[#Custom Functions (DEFINE FUNCTION)]]
- [[#Embedded JavaScript Functions]]
- [[#Surrealism (WASM Extensions)]]
- [[#Built-in Function Library]]
- [[#Full-Text Search System]]
- [[#Index Types]]
- [[#DEFINE EVENT]]
- [[#Pre-computed Table Views (DEFINE TABLE AS)]]
- [[#DEFINE API (3.0)]]
- [[#Other DEFINE Statements]]

---

## Custom Functions (DEFINE FUNCTION)

`DEFINE FUNCTION` creates reusable named functions scoped to a database. Functions must be prefixed with `fn::` and can accept typed arguments, contain control flow, and call other functions recursively.

### Basic Syntax

```surql
DEFINE FUNCTION fn::greet($name: string) {
    "Hello, " + $name + "!"
};

RETURN fn::greet("Tobie");
-- "Hello, Tobie!"
```

### Namespaced Functions

Functions can be deeply namespaced using `::` separators:

```surql
DEFINE FUNCTION fn::my::custom::namespaced::lowercase($name: string) {
    RETURN string::lowercase($name);
};
```

### Complex Example: Check Relation Existence

```surql
DEFINE FUNCTION fn::relation_exists(
    $in: record,
    $tb: string,
    $out: record
) {
    LET $results = SELECT VALUE id FROM type::table($tb)
        WHERE in = $in AND out = $out;
    RETURN array::len($results) > 0;
};
```

### Recursive Functions

```surql
DEFINE FUNCTION fn::relate_all($records: array<record>) {
    IF $records.len() < 2 {
        -- Base case: stop recursion
    } ELSE {
        LET $first = $records;
        LET $remainder = $records[1..];
        FOR $counterpart IN $remainder {
            RELATE $first->to->$counterpart;
        };
        fn::relate_all($remainder);
    }
};

CREATE |person:1..8|;
fn::relate_all(SELECT VALUE id FROM person);
```

### Optional Arguments

Functions can have optional arguments with default values:

```surql
DEFINE FUNCTION fn::format_name($first: string, $last: option<string>) {
    IF $last {
        RETURN $first + " " + $last;
    } ELSE {
        RETURN $first;
    }
};
```

### Permissions on Functions

```surql
DEFINE FUNCTION fn::admin_only()
    PERMISSIONS WHERE $auth.role = "admin"
{
    RETURN "Secret data";
};
```

---

## Embedded JavaScript Functions

SurrealDB embeds a JavaScript runtime (via `rquickjs`) allowing inline JavaScript execution. Each invocation runs in an isolated context with resource limits.

### Inline JavaScript in CREATE

The `function()` block embeds JS directly. The `this` keyword refers to the current record:

```surql
CREATE film SET
    ratings = [
        { rating: 6, user: user:alice },
        { rating: 8, user: user:bob },
    ],
    featured = function() {
        return this.ratings.filter(r => {
            return r.rating >= 7;
        }).map(r => {
            return { ...r, rating: r.rating * 10 };
        });
    }
;
```

### Built-in JS Objects

Inside `function()` blocks, the following APIs are available:

**`surrealdb.query(surql, params?)`** - Execute SurrealQL from JavaScript:

```surql
RETURN function() {
    return await surrealdb.query(
        `SELECT number FROM test WHERE name = $name`,
        { name: "b" }
    );
};
```

**`surrealdb.value(expression)`** - Evaluate SurrealQL expressions:

```surql
LET $something = 123;
LET $obj = { nested: 456 };
LET $arr = [
    { value: 1 }, { value: 2 }, { value: 3 },
    { value: 4 }, { value: 5 }, { value: 6 },
];

RETURN function() {
    const something = await surrealdb.value("$something");
    const nested = await surrealdb.value("$obj.nested");
    const fromArray = await surrealdb.value("$arr[WHERE value > 3].value");
    return { something, nested, fromArray };
};
```

**`fetch(resource, options)`** - HTTP requests (requires `http` feature):

```surql
RETURN function() {
    let response = await fetch("https://api.example.com/data");
    return await response.json();
};
```

### Security & Isolation

| Setting | Default | Description |
|---------|---------|-------------|
| `SCRIPTING_MAX_STACK_SIZE` | 256 KiB | Maximum JS stack size |
| `SCRIPTING_MAX_MEMORY_LIMIT` | 2 MiB | Maximum JS memory |
| Max execution time | 5 seconds | Script timeout |

Each script execution gets its own isolated runtime and context. Scripts are cancelled if they exceed time limits or if the database context terminates.

---

## Surrealism (WASM Extensions)

Introduced with SurrealDB 3.0, **Surrealism** is an open-source extension framework allowing you to write functions in Rust (compiled to WebAssembly) and execute them inside the database.

### How It Works

1. Write your functions in Rust
2. Compile to WebAssembly (WASM)
3. Load the WASM module into SurrealDB using `DEFINE MODULE`
4. Call functions from SurrealQL

### Key Properties

- WASM modules execute in a sandboxed, deterministic environment
- Can be loaded or upgraded without taking the database offline
- Full access to SurrealDB's query engine, schema, and file functionality
- Strong isolation -- each invocation runs in a fully isolated context
- Permissions controlled via SurrealDB's built-in permission clauses
- Future support planned for JavaScript and Python extensions

### Use Cases

- AI agent workflows with low-latency execution
- Custom business logic close to the data
- Complex data transformations
- Custom authentication and access control logic

---

## Built-in Function Library

SurrealDB ships with an extensive library of built-in functions organized into modules.

### Array Functions (`array::`)

Comprehensive array manipulation. Key functions:

```surql
-- Length, append, prepend
array::len([1, 2, 3]);                    -- 3
array::append([1, 2], 3);                 -- [1, 2, 3]
array::prepend([2, 3], 1);                -- [1, 2, 3]

-- Set operations
array::union([1, 2], [2, 3]);             -- [1, 2, 3]
array::intersect([1, 2, 3], [2, 3, 4]);   -- [2, 3]
array::complement([1, 2, 3], [2]);         -- [1, 3]
array::distinct([1, 2, 2, 3, 3]);         -- [1, 2, 3]

-- Transformation
array::flatten([[1, 2], [3, 4]]);          -- [1, 2, 3, 4]
array::transpose([[1, 2], [3, 4]]);        -- [[1, 3], [2, 4]]
array::sort::asc([3, 1, 2]);              -- [1, 2, 3]
array::reverse([1, 2, 3]);                -- [3, 2, 1]

-- Searching
array::find([1, 2, 3], 2);                -- 2
array::find_index([1, 2, 3], 2);           -- 1

-- Aggregation
array::fold([1, 2, 3, 4, 5], 0, |$acc, $val| { $acc + $val });

-- Sliding windows
array::windows([1, 2, 3, 4], 2);          -- [[1, 2], [2, 3], [3, 4]]
```

Also includes: `array::add`, `array::all`, `any`, `at`, `boolean_and`, `boolean_not`, `boolean_or`, `boolean_xor`, `clump`, `combine`, `concat`, `diff`, `every`, `filter_index`, `first`, `group`, `insert`, `is_empty`, `join`, `last`, `len`, `logical_and`, `logical_or`, `logical_xor`, `matches`, `max`, `min`, `pop`, `push`, `range`, `remove`, `repeat`, `slice`, `some`, `sort_lexical`, `sort_natural`, `swap`, `windows`.

### String Functions (`string::`)

```surql
string::lowercase("HELLO");               -- "hello"
string::uppercase("hello");               -- "HELLO"
string::capitalize("hello world");         -- "Hello World"
string::trim("  hello  ");                -- "hello"
string::len("hello");                      -- 5
string::contains("hello world", "world");  -- true
string::starts_with("hello", "he");        -- true
string::ends_with("hello", "lo");          -- true
string::split("a,b,c", ",");              -- ["a", "b", "c"]
string::join(", ", "a", "b", "c");         -- "a, b, c"
string::replace("hello", "l", "r");        -- "herro"
string::reverse("hello");                  -- "olleh"
string::slug("Hello World!");              -- "hello-world"
string::repeat("ab", 3);                   -- "ababab"
string::matches("test123", "[0-9]+");      -- true

-- Distance metrics
string::distance::levenshtein("kitten", "sitting");
string::distance::hamming("karolin", "kathrin");
string::distance::damerau_levenshtein("abc", "acb");

-- Validation
string::is_email("user@example.com");      -- true
string::is_domain("surrealdb.com");        -- true
string::is_ip("192.168.1.1");             -- true
string::is_numeric("12345");               -- true
string::is_alpha("hello");                 -- true
string::is_alphanum("hello123");           -- true
string::is_ascii("hello");                 -- true
string::is_hexadecimal("1a2b3c");          -- true
string::is_uuid("...");                    -- true

-- Security
string::html::encode("<script>alert('xss')</script>");
string::html::sanitize("<b>bold</b><script>bad</script>");
```

### Math Functions (`math::`)

Comprehensive statistical analysis and mathematical operations:

```surql
-- Basic math
math::abs(-5);              -- 5
math::ceil(4.2);            -- 5
math::floor(4.8);           -- 4
math::round(4.5);           -- 5
math::pow(2, 10);           -- 1024
math::sqrt(144);            -- 12
math::clamp(15, 0, 10);     -- 10
math::sign(-5);             -- -1
math::lerp(0, 10, 0.5);    -- 5

-- Logarithms
math::ln(2.718281828);
math::log(100, 10);         -- 2
math::log2(8);              -- 3
math::log10(1000);           -- 3

-- Trigonometry
math::sin(math::pi / 2);    -- 1
math::cos(0);                -- 1
math::tan(math::pi / 4);    -- ~1
math::asin(1);
math::acos(1);
math::atan(1);
math::deg2rad(180);          -- pi
math::rad2deg(math::pi);     -- 180

-- Statistical functions (work on arrays)
math::mean([1, 2, 3, 4, 5]);       -- 3
math::median([1, 2, 3, 4, 5]);     -- 3
math::mode([1, 2, 2, 3]);          -- 2
math::min([5, 3, 8, 1]);           -- 1
math::max([5, 3, 8, 1]);           -- 8
math::sum([1, 2, 3]);              -- 6
math::product([2, 3, 4]);          -- 24
math::spread([1, 5, 10]);          -- 9
math::stddev([2, 4, 4, 4, 5, 5, 7, 9]);
math::variance([2, 4, 4, 4, 5, 5, 7, 9]);
math::percentile([1, 2, 3, 4, 5], 75);
math::nearestrank([1, 2, 3, 4, 5], 75);
math::interquartile([1, 2, 3, 4, 5]);
math::midhinge([1, 2, 3, 4, 5]);
math::trimean([1, 2, 3, 4, 5]);
math::top([5, 3, 8, 1, 9], 3);     -- [9, 8, 5]
math::bottom([5, 3, 8, 1, 9], 3);  -- [1, 3, 5]

-- Constants
math::pi;          -- 3.141592653589793
math::tau;         -- 6.283185307179586
math::e;           -- 2.718281828459045
math::inf;         -- positive infinity
math::neg_inf;     -- negative infinity
```

### Crypto Functions (`crypto::`)

```surql
-- Hashing
crypto::md5("data");            -- MD5 hash
crypto::sha1("data");           -- SHA-1 hash
crypto::sha256("data");         -- SHA-256 hash
crypto::sha512("data");         -- SHA-512 hash
crypto::blake3("data");         -- BLAKE3 hash
crypto::joaat("data");          -- Jenkins hash

-- Password hashing (use these for passwords, NOT md5/sha)
crypto::argon2::generate("MyPassword");
crypto::argon2::compare($hash, "MyPassword");

crypto::bcrypt::generate("MyPassword");
crypto::bcrypt::compare($hash, "MyPassword");

crypto::pbkdf2::generate("MyPassword");
crypto::pbkdf2::compare($hash, "MyPassword");

crypto::scrypt::generate("MyPassword");
crypto::scrypt::compare($hash, "MyPassword");
```

> **Security note:** Never use `md5`, `sha1`, `sha256`, or `sha512` for password hashing. Always use `argon2`, `bcrypt`, `pbkdf2`, or `scrypt` which include salting and computational cost.

### Geo Functions (`geo::`)

```surql
-- Distance (haversine, in meters)
geo::distance(
    (-0.04, 51.55),   -- London
    (30.46, -17.86)    -- Harare
);
-- 8268604.25 meters

-- Bearing between two points
geo::bearing((-0.04, 51.55), (30.46, -17.86));

-- Area of a polygon
geo::area({
    type: "Polygon",
    coordinates: [[[0,0], [10,0], [10,10], [0,10], [0,0]]]
});

-- Centroid of a geometry
geo::centroid({
    type: "Polygon",
    coordinates: [[[0,0], [10,0], [10,10], [0,10], [0,0]]]
});

-- Geohash encode/decode
geo::hash::encode((-0.118092, 51.509865));     -- geohash string
geo::hash::decode("gcpuuz");                    -- geometry point

-- Validity check
geo::is_valid((51.509865, -0.118092));          -- true
```

### Time Functions (`time::`)

```surql
-- Current time
time::now();

-- Extract components
time::year(d"2026-02-23T10:30:00Z");     -- 2026
time::month(d"2026-02-23T10:30:00Z");    -- 2
time::day(d"2026-02-23T10:30:00Z");      -- 23
time::hour(d"2026-02-23T10:30:00Z");     -- 10
time::minute(d"2026-02-23T10:30:00Z");   -- 30
time::second(d"2026-02-23T10:30:00Z");   -- 0
time::wday(d"2026-02-23T10:30:00Z");     -- day of week
time::week(d"2026-02-23T10:30:00Z");     -- week number
time::yday(d"2026-02-23T10:30:00Z");     -- day of year
time::is_leap_year(d"2024-01-01T00:00:00Z"); -- true

-- Rounding
time::floor(d"2026-02-23T10:30:17Z", 1h);  -- rounds down to hour
time::ceil(d"2026-02-23T10:30:17Z", 1h);   -- rounds up to hour
time::round(d"2026-02-23T10:30:17Z", 1h);  -- rounds to nearest hour

-- Grouping
time::group(d"2026-02-23T10:30:17Z", "month"); -- first of month

-- Formatting
time::format(d"2026-02-23T10:30:17Z", "%Y-%m-%d"); -- "2026-02-23"

-- Unix conversions
time::unix(d"2026-02-23T10:30:00Z");    -- unix timestamp
time::from_unix(1772000000);
time::from_millis(1772000000000);
time::from_micros(1772000000000000);
time::from_nanos(1772000000000000000);

-- From ULID/UUID
time::from_ulid($ulid);
time::from_uuid($uuid);

-- Epoch and extremes
time::epoch;       -- 1970-01-01T00:00:00Z
time::minimum;     -- smallest datetime
time::maximum;     -- largest datetime

-- Min/max from arrays
time::min([d"2020-01-01", d"2025-01-01"]);
time::max([d"2020-01-01", d"2025-01-01"]);
```

### HTTP Functions (`http::`)

Make outgoing HTTP requests directly from SurrealQL:

```surql
-- GET request
RETURN http::get("https://api.example.com/users");

-- POST with body and headers
RETURN http::post(
    "https://api.example.com/webhook",
    { event: "user_created", user: $user },
    { "Authorization": "Bearer token123" }
);

-- All HTTP methods
http::head(url);
http::get(url, headers?);
http::put(url, body?, headers?);
http::post(url, body?, headers?);
http::patch(url, body?, headers?);
http::delete(url, headers?);
```

JSON responses are automatically parsed into SurrealDB values.

### Parse Functions (`parse::`)

```surql
-- Email parsing
parse::email::host("user@surrealdb.com");   -- "surrealdb.com"
parse::email::user("user@surrealdb.com");   -- "user"

-- URL parsing
parse::url::domain("https://surrealdb.com/features?v=1#top");  -- "surrealdb.com"
parse::url::host("https://surrealdb.com/features");             -- "surrealdb.com"
parse::url::path("https://surrealdb.com/features");             -- "/features"
parse::url::port("https://surrealdb.com:8080/");                -- 8080
parse::url::scheme("https://surrealdb.com");                    -- "https"
parse::url::query("https://surrealdb.com?some=option");         -- "some=option"
parse::url::fragment("https://surrealdb.com#fragment");         -- "fragment"
```

### Rand Functions (`rand::`)

```surql
rand();                      -- random float 0..1
rand::bool();                -- random boolean
rand::int(1, 100);           -- random int in range
rand::float(0.0, 1.0);      -- random float in range
rand::string(10);            -- random 10-char string
rand::string(5, 15);         -- random string, length 5-15
rand::time();                -- random datetime
rand::duration();             -- random duration
rand::enum("a", "b", "c");  -- random pick from values
rand::uuid();                -- random UUID v7
rand::uuid::v4();            -- random UUID v4
rand::ulid();                -- random ULID
rand::id();                  -- random 20-char ID string
rand::id(10);                -- random 10-char ID string
```

### Object Functions (`object::`)

```surql
object::keys({ a: 1, b: 2 });           -- ["a", "b"]
object::values({ a: 1, b: 2 });         -- [1, 2]
object::entries({ a: 1, b: 2 });         -- [["a", 1], ["b", 2]]
object::from_entries([["a", 1], ["b", 2]]); -- { a: 1, b: 2 }
object::len({ a: 1, b: 2 });            -- 2
object::is_empty({});                     -- true
object::extend({ a: 1 }, { b: 2 });      -- { a: 1, b: 2 }
object::remove({ a: 1, b: 2 }, "a");     -- { b: 2 }
```

### Type Functions (`type::`)

```surql
-- Conversion
type::bool("true");         -- true
type::int("42");            -- 42
type::float("3.14");        -- 3.14
type::string(42);           -- "42"
type::number("42");         -- 42
type::point(51.5, -0.1);   -- geometry point
type::record("person", "tobie"); -- person:tobie
type::table("person");      -- person (table type)
type::range(1, 10);         -- 1..10
type::uuid("...");

-- Type checking (v3.0 unified syntax)
type::is_array([1, 2]);     -- true
type::is_bool(true);        -- true
type::is_datetime(d"2026-01-01");
type::is_decimal(1.5dec);
type::is_float(1.5f);
type::is_int(42);
type::is_null(NULL);
type::is_number(42);
type::is_object({});
type::is_point((0, 0));
type::is_record(person:one);
type::is_string("hello");
type::is_uuid(rand::uuid());

-- Type identification
type::of(42);               -- "int"
type::of("hello");          -- "string"
```

### Vector Functions (`vector::`)

Essential for AI/ML and numerical computation:

```surql
-- Element-wise operations
vector::add([1, 2, 3], [4, 5, 6]);       -- [5, 7, 9]
vector::subtract([4, 5, 6], [1, 2, 3]);  -- [3, 3, 3]
vector::multiply([1, 2, 3], [4, 5, 6]);  -- [4, 10, 18]
vector::divide([4, 6, 8], [2, 3, 4]);    -- [2, 2, 2]
vector::scale([1, 2, 3], 2);              -- [2, 4, 6]

-- Vector properties
vector::magnitude([3, 4]);                 -- 5
vector::normalize([3, 4]);                 -- [0.6, 0.8]
vector::dot([1, 2, 3], [4, 5, 6]);        -- 32
vector::cross([1, 0, 0], [0, 1, 0]);      -- [0, 0, 1]
vector::angle([1, 0], [0, 1]);
vector::project([3, 4], [1, 0]);

-- Distance metrics
vector::distance::euclidean([0, 0], [3, 4]);    -- 5
vector::distance::manhattan([0, 0], [3, 4]);     -- 7
vector::distance::chebyshev([0, 0], [3, 4]);     -- 4
vector::distance::hamming([1, 0, 1], [1, 1, 0]); -- 2
vector::distance::minkowski([0, 0], [3, 4], 3);
vector::distance::knn();  -- reuses distance computed during KNN query

-- Similarity
vector::similarity::cosine([1, 2], [2, 4]);     -- 1.0
vector::similarity::jaccard([1, 2, 3], [2, 3, 4]);
vector::similarity::pearson([1, 2, 3], [4, 5, 6]);
```

### Other Function Modules

| Module | Description | Example |
|--------|-------------|---------|
| `count()` | Count values/expressions | `count([1, 2, 3])` returns 3 |
| `not()` | Reverse truthiness | `not(true)` returns false |
| `sleep()` | Pause execution | `sleep(1s)` |
| `bytes::` | Byte operations | `bytes::len("hello".to_bytes())` |
| `duration::` | Duration conversion | `duration::days(90h30m)` |
| `encoding::` | Base64 / CBOR | `encoding::base64::encode("hello")` |
| `record::` | Record ID operations | `record::tb(person:one)` returns "person" |
| `session::` | Session info | `session::db()`, `session::ns()` |
| `meta::` | Record metadata (deprecated) | Replaced by `record::` |
| `set::` | Set operations | Distinct value operations |
| `value::` | Value operations | Value comparison and manipulation |
| `sequence::` | Sequence operations | Auto-incrementing values |
| `api::` | API middleware | `api::timeout(1s)` |
| `file::` / `f""` | File operations (v3.0) | `f"bucket:/file.txt".get()` |

### Method Chaining Syntax (v3.0)

As of v3.0, functions can be called as methods using underscore syntax:

```surql
-- Old double-colon syntax
type::is::record(person:one);

-- New method syntax (matches underscore convention)
person:one.is_record();
type::is_record(person:one);

-- Chaining
[1, 2, 3, 4, 5]
    .filter(|$v| $v > 2)
    .map(|$v| $v * 10)
    .flatten()
    .distinct()
    .windows(2)
    .len();
```

---

## Full-Text Search System

SurrealDB provides a complete full-text search engine built in. The pipeline is: **Analyzer (optional function + tokenizers + filters) -> Index (BM25 scoring) -> Search functions**.

### DEFINE ANALYZER

Analyzers control how text is tokenized and filtered before indexing.

```surql
DEFINE ANALYZER @name
    [FUNCTION fn::@name]
    TOKENIZERS @tokenizers
    FILTERS @filters;
```

### Tokenizers

Tokenizers split input text into individual tokens:

| Tokenizer | Description | Example Input | Tokens |
|-----------|-------------|---------------|--------|
| `blank` | Splits on whitespace | `"hello world"` | `["hello", "world"]` |
| `camel` | Splits on camelCase boundaries | `"camelCase"` | `["camel", "Case"]` |
| `class` | Splits on character class changes (letters, numbers, symbols) | `"hello123world"` | `["hello", "123", "world"]` |
| `punct` | Splits on punctuation marks | `"hello,world!"` | `["hello", "world"]` |

Multiple tokenizers can be combined:

```surql
DEFINE ANALYZER my_analyzer TOKENIZERS blank, class FILTERS lowercase;
```

### Filters

Filters transform tokens after tokenization:

| Filter | Description | Example |
|--------|-------------|---------|
| `ascii` | Converts Unicode to ASCII equivalents | `"cafe"` -> `"cafe"` |
| `lowercase` | Converts to lowercase | `"Hello"` -> `"hello"` |
| `uppercase` | Converts to uppercase | `"hello"` -> `"HELLO"` |
| `snowball(lang)` | Applies Snowball stemming for a language | `"running"` -> `"run"` (english) |
| `edgengram(min, max)` | Generates n-grams from token start | `"hello"` with (2,4) -> `["he", "hel", "hell"]` |
| `ngram(min, max)` | Generates n-grams from entire token | `"hello"` with (2,3) -> `["he", "hel", "el", "ell", ...]` |
| `mapper(path)` | Custom token mapping file | Synonym replacement, etc. |

### Analyzer Examples

```surql
-- English language search with stemming
DEFINE ANALYZER english
    TOKENIZERS blank, class
    FILTERS lowercase, snowball(english);

-- Autocomplete with edge n-grams
DEFINE ANALYZER autocomplete
    TOKENIZERS blank
    FILTERS lowercase, edgengram(2, 10);

-- Simple whitespace + lowercase
DEFINE ANALYZER simple
    TOKENIZERS blank
    FILTERS lowercase, ascii;

-- Custom pre-processing function
DEFINE FUNCTION fn::stripHtml($html: string) {
    RETURN string::replace($html, /<[^>]*>/, "");
};

DEFINE ANALYZER html_analyzer
    FUNCTION fn::stripHtml
    TOKENIZERS blank, class
    FILTERS lowercase;
```

### Creating Full-Text Search Indexes

```surql
-- Basic full-text index
DEFINE INDEX ft_content ON article
    FIELDS content
    SEARCH ANALYZER english BM25;

-- With custom BM25 parameters (k1, b) and highlights
DEFINE INDEX ft_title ON blog
    FIELDS title
    SEARCH ANALYZER simple BM25(1.2, 0.75) HIGHLIGHTS;

-- Build index concurrently (non-blocking)
DEFINE INDEX ft_body ON post
    FIELDS body
    SEARCH ANALYZER english BM25
    CONCURRENTLY;
```

> **Note:** As of SurrealDB 3.0, the syntax changed from `FULLTEXT ANALYZER` to `SEARCH ANALYZER`.

### Search Functions

Use the `@N@` match operator in WHERE clauses, where N is a reference number used with search functions:

**`search::score(ref)`** - Get BM25 relevance score:

```surql
SELECT id, title, search::score(1) AS score
FROM article
WHERE title @1@ 'surrealdb'
ORDER BY score DESC;
```

**`search::highlight(prefix, suffix, ref, partial?)`** - Highlight matching terms:

```surql
SELECT
    search::highlight('<b>', '</b>', 1) AS title,
    search::score(1) AS score
FROM blog
WHERE title @1@ 'database'
ORDER BY score DESC;
```

**`search::offsets(ref, partial?)`** - Get byte offsets of matches:

```surql
SELECT search::offsets(1) AS offsets
FROM blog
WHERE content @1@ 'surrealdb';
```

### Complete Full-Text Search Example

```surql
-- 1. Define an analyzer
DEFINE ANALYZER english
    TOKENIZERS blank, class
    FILTERS lowercase, snowball(english);

-- 2. Define the index
DEFINE INDEX content ON article
    FIELDS content
    SEARCH ANALYZER english BM25 HIGHLIGHTS;

-- 3. Insert data
CREATE article SET content = "Join us at SurrealDB World!";
CREATE article SET content = "We will be at Surreal World!";

-- 4. Search with scoring and highlighting
SELECT
    search::highlight('<mark>', '</mark>', 1) AS content,
    search::score(1) AS relevance
FROM article
WHERE content @1@ 'surreal world'
ORDER BY relevance DESC;
```

---

## Index Types

SurrealDB supports multiple index types defined via `DEFINE INDEX`.

### Non-Unique Index

Standard B-tree index for faster lookups. Allows duplicate values:

```surql
DEFINE INDEX idx_genre ON TABLE person COLUMNS genre;
DEFINE INDEX idx_city ON TABLE user FIELDS city;
```

### Unique Index

Enforces uniqueness -- no two records can share the same indexed value:

```surql
DEFINE INDEX email ON TABLE user COLUMNS email UNIQUE;
DEFINE INDEX uniq_name ON TABLE person COLUMNS name UNIQUE;
```

### Composite Index

Index on multiple fields together:

```surql
DEFINE INDEX idx_name ON TABLE person FIELDS firstName, lastName;
DEFINE INDEX idx_location_date ON TABLE reading FIELDS location, recorded_at;

-- Composite unique
DEFINE INDEX risk_name ON risk FIELDS project, description UNIQUE;
```

### Full-Text Search Index

See the [[#Full-Text Search System]] section above. Summary:

```surql
DEFINE ANALYZER simple TOKENIZERS blank, class FILTERS lowercase, ascii;

DEFINE INDEX ft_content ON article
    FIELDS content
    SEARCH ANALYZER simple BM25(1.2, 0.75) HIGHLIGHTS;
```

### HNSW Vector Index

Hierarchical Navigable Small World (HNSW) indexes enable efficient approximate nearest neighbor (ANN) search on vector embeddings.

**How HNSW works:** Vectors are organized in a multi-layer graph. Searches start at a sparse top layer and navigate down to denser layers, progressively finding closer neighbors. SurrealDB's implementation supports concurrent reads and writes.

#### Parameters

| Parameter | Default | Options | Description |
|-----------|---------|---------|-------------|
| `DIMENSION` | (required) | any integer | Vector dimensionality |
| `DIST` | `EUCLIDEAN` | `EUCLIDEAN`, `COSINE`, `MANHATTAN` | Distance function |
| `TYPE` | `F64` | `F64`, `F32`, `I64`, `I32`, `I16` | Vector component type |
| `EFC` | 150 | any integer | ef_construction - candidate list size during build |
| `M` | 12 | any integer | Max connections per node |
| `M0` | `M * 2` | any integer | Max connections in base layer |
| `LM` | `1/ln(M)` | float | Layer generation multiplier |
| `EXTEND_CANDIDATES` | false | flag | Extend candidate set during construction |
| `KEEP_PRUNED_CONNECTIONS` | false | flag | Retain pruned connections |
| `HASHED_VECTOR` | false | flag | Use vector hashing for retrieval |

#### Examples

```surql
-- Basic vector index
DEFINE INDEX idx_embedding ON TABLE document
    FIELDS embedding
    HNSW DIMENSION 384 DIST COSINE;

-- High-performance config with type and construction params
DEFINE INDEX hnsw_pts ON pts
    FIELDS point
    HNSW DIMENSION 4 DIST EUCLIDEAN TYPE F32 EFC 500 M 12;

-- Full configuration
DEFINE INDEX idx_vec ON TABLE items
    FIELDS embedding
    HNSW DIMENSION 128
    EFC 250
    TYPE F32
    DIST MANHATTAN
    M 6
    M0 12
    LM 0.5
    EXTEND_CANDIDATES
    KEEP_PRUNED_CONNECTIONS
    HASHED_VECTOR;
```

#### KNN Queries with Vector Indexes

```surql
-- KNN search (uses HNSW index if available, brute force otherwise)
LET $query_vec = [0.1, 0.2, 0.3, ...];

SELECT id, title,
    vector::distance::knn() AS distance
FROM document
WHERE embedding <|10,COSINE|> $query_vec
ORDER BY distance;

-- Manual distance calculation (brute force)
SELECT id, title,
    vector::similarity::cosine(embedding, $query_vec) AS similarity
FROM document
ORDER BY similarity DESC
LIMIT 10;
```

### Concurrent Index Building

Any index can be built concurrently to avoid blocking writes:

```surql
DEFINE INDEX idx_name ON TABLE person FIELDS name CONCURRENTLY;

-- Check build status
INFO FOR INDEX idx_name ON person;
```

### Rebuilding Indexes

```surql
REBUILD INDEX idx_name ON TABLE person;
REBUILD INDEX ft_content ON article;
```

---

## DEFINE EVENT

Events are triggers that execute SurrealQL when conditions are met on table operations. They fire on `CREATE`, `UPDATE`, or `DELETE` events.

### Syntax

```surql
DEFINE EVENT @name ON TABLE @table
    WHEN @condition
    THEN @action;
```

### Available Variables

| Variable | Description |
|----------|-------------|
| `$event` | Event type: `"CREATE"`, `"UPDATE"`, or `"DELETE"` |
| `$before` | Record state before the change |
| `$after` | Record state after the change |
| `$value` | Current record value |

### Examples

```surql
-- Log email changes
DEFINE EVENT email_change ON TABLE user
    WHEN $before.email != $after.email
    THEN (
        CREATE event SET
            user = $value,
            time = time::now(),
            value = $after.email,
            action = 'email_changed'
    );

-- Track all events with specific conditions
DEFINE EVENT email_audit ON TABLE user
    WHEN $event = "CREATE" OR $event = "UPDATE" OR $event = "DELETE"
    THEN (
        CREATE log SET
            user = $after.id ?? $before.id,
            action = $event,
            at = time::now(),
            old_email = $before.email ?? "",
            new_email = $after.email ?? ""
    );

-- Publish event on creation
DEFINE EVENT publish_post ON TABLE publish_post
    WHEN $event = "CREATE"
    THEN (
        UPDATE post SET status = "PUBLISHED"
        WHERE id = $after.post_id
    );

-- Notification on update
DEFINE EVENT user_updated ON TABLE user
    WHEN $event = "UPDATE"
    THEN (
        CREATE notification SET
            message = "User updated",
            user_id = $after.id,
            created_at = time::now()
    );

-- Webhook on delete
DEFINE EVENT user_deleted ON TABLE user
    WHEN $event = "DELETE"
    THEN (
        http::post("https://webhook.example.com/user-deleted", {
            user_id: $before.id,
            deleted_at: time::now()
        })
    );

-- Purchase event with relationship creation
DEFINE EVENT purchase ON TABLE purchase
    WHEN $event = "CREATE"
    THEN {
        CREATE log SET
            action = "purchase",
            customer = $after.customer,
            product = $after.product,
            at = time::now();
        RELATE $after.customer->bought->$after.product;
    };
```

---

## Pre-computed Table Views (DEFINE TABLE AS)

Pre-computed table views are **materialized views** -- they are incrementally updated as source data changes, not recomputed on every query.

### Syntax

```surql
DEFINE TABLE @name AS
    SELECT @projections
    FROM @table
    [WHERE @condition]
    [GROUP BY @fields | GROUP ALL];
```

### Examples

```surql
-- Average product reviews (auto-updated on each review change)
DEFINE TABLE avg_product_review TYPE NORMAL AS
    SELECT
        count() AS number_of_reviews,
        math::mean(<float> rating) AS avg_review,
        ->product.id AS product_id,
        ->product.name AS product_name
    FROM review
    GROUP BY product_id, product_name;

-- Query it like a regular table
SELECT * FROM avg_product_review;
```

```surql
-- Temperature aggregation by city
DEFINE TABLE temperatures_by_month AS
    SELECT
        count() AS total,
        time::month(recorded_at) AS month,
        math::mean(temperature) AS average_temp
    FROM reading
    GROUP BY city;
```

```surql
-- Traffic snapshot aggregation
DEFINE TABLE traffic AS
    SELECT
        location,
        time::format(at, "%Y-%m-%d:%H:00:00") AS at,
        math::sum(cars) AS cars,
        math::sum(trucks) AS trucks
    FROM traffic_snapshot
    GROUP BY location, at;
```

### DROP Tables with Views

Use `DROP` tables when you only need the aggregated view, not the raw data:

```surql
-- Raw readings are discarded after view update
DEFINE TABLE sensor_readings DROP;

DEFINE TABLE daily_measurements AS
    SELECT
        math::mean(temperature) AS avg_temp,
        math::mean(humidity) AS avg_humidity,
        time::day(recorded_at) AS day
    FROM sensor_readings
    GROUP BY location, day;
```

### Key Characteristics

- **Materialized**, not virtual -- data is stored and incrementally updated
- Only a single record modification per view record for each source write
- Support `count()`, `math::mean()`, `math::sum()`, `math::max()`, `math::min()`, and other aggregates
- Can use `GROUP BY` or `GROUP ALL`
- Can reference graph traversals (`->relation.field`)
- Views have their own record IDs based on group key values

---

## DEFINE API (3.0)

New in SurrealDB 3.0, `DEFINE API` creates custom HTTP endpoints directly inside the database with middleware support.

```surql
-- Simple API endpoint
DEFINE API "/hello" FOR get THEN {
    { status: 200, body: { message: "Hello, World!" } };
};

-- With middleware
DEFINE FUNCTION fn::add_prefix($req: object, $next: function, $prefix: string) -> object {
    LET $res = $next($req);
    LET $res = $res + {
        body: $res.body + {
            prefix: $prefix + ": " + $res.body.message
        }
    };
    $res;
};

DEFINE API "/custom_with_args" FOR get
    MIDDLEWARE fn::add_prefix("PREFIX")
    THEN {
        { status: 200, body: { message: "original message" } };
    };

-- Chained middleware with timer
DEFINE FUNCTION fn::start_timer($req: object, $next: function, $called_at: datetime) -> object {
    LET $res = $next($req);
    $res + { context: { called_at: $called_at } }
};

DEFINE FUNCTION fn::increment_num($req: object, $next: function) -> object {
    LET $res = $next($req);
    $res + { body: { num: $res.body.num + 1 } }
};

DEFINE API "/custom_response" FOR get
    MIDDLEWARE fn::start_timer(time::now()), fn::increment_num()
    THEN {
        { status: 200, body: { num: 1 } };
    };

-- Invoke programmatically
api::invoke("/custom_response");
```

---

## Other DEFINE Statements

SurrealDB provides a comprehensive set of `DEFINE` statements for schema management:

| Statement | Purpose |
|-----------|---------|
| `DEFINE NAMESPACE` | Create a namespace (top-level isolation) |
| `DEFINE DATABASE` | Create a database within a namespace |
| `DEFINE TABLE` | Define a table with schema rules, type, permissions |
| `DEFINE FIELD` | Define field types, defaults, assertions, computed values |
| `DEFINE INDEX` | Create indexes (unique, search, vector) |
| `DEFINE ANALYZER` | Create text analyzers for full-text search |
| `DEFINE FUNCTION` | Create reusable custom functions |
| `DEFINE EVENT` | Create event triggers on table operations |
| `DEFINE PARAM` | Define global parameters |
| `DEFINE USER` | Create database users with roles |
| `DEFINE ACCESS` | Define authentication access methods (record, JWT, etc.) |
| `DEFINE API` | Create custom HTTP endpoints (v3.0) |
| `DEFINE MODULE` | Load WASM/Surrealism extensions (v3.0) |
| `DEFINE BUCKET` | Define file storage buckets (v3.0) |
| `DEFINE SEQUENCE` | Create auto-incrementing sequences |
| `DEFINE CONFIG` | Set database configuration options |

### DEFINE FIELD (Notable Features)

```surql
-- Typed field with assertion
DEFINE FIELD email ON TABLE user TYPE string
    ASSERT string::is_email($value);

-- Default value
DEFINE FIELD created_at ON TABLE user TYPE datetime
    DEFAULT time::now();

-- Computed field (v3.0 -- not stored, computed on access)
DEFINE FIELD full_name ON TABLE user
    COMPUTED first_name + " " + last_name;

-- VALUE field (computed on write)
DEFINE FIELD slug ON TABLE article
    VALUE string::slug(title);

-- Reference with cascade delete
DEFINE FIELD author ON TABLE article TYPE record<user>
    REFERENCE ON DELETE CASCADE;

-- Readonly field
DEFINE FIELD created_by ON TABLE document TYPE record<user>
    DEFAULT $auth.id
    READONLY;
```

### DEFINE PARAM

```surql
-- Global parameter accessible everywhere in the database
DEFINE PARAM $app_name VALUE "My Application";
DEFINE PARAM $max_results VALUE 100;

-- Use in queries
SELECT * FROM user LIMIT $max_results;
```

### DEFINE SEQUENCE

```surql
DEFINE SEQUENCE invoice_number;

-- Use in queries
CREATE invoice SET
    number = sequence::nextval("invoice_number"),
    created_at = time::now();
```

---

## Summary

SurrealDB's advanced features combine to create a powerful, extensible database:

- **Custom Functions** (`DEFINE FUNCTION`) provide reusable SurrealQL logic with type safety, recursion, and permissions
- **JavaScript Embedding** allows inline JS with isolated execution and database interop via `surrealdb.query/value`
- **Surrealism** (v3.0) brings WASM extensions for high-performance custom logic inside the database
- **30+ built-in function modules** cover math, strings, arrays, crypto, geo, time, HTTP, parsing, vectors, and more
- **Full-text search** uses configurable analyzers (tokenizers + filters) with BM25 scoring, highlights, and scoring functions
- **Multiple index types** including unique, composite, full-text, and HNSW vector indexes for approximate nearest neighbor search
- **Events** provide trigger-based automation on data changes
- **Pre-computed table views** deliver incrementally-updated materialized views
- **DEFINE API** (v3.0) brings HTTP endpoint creation directly into the database layer

---

*See also:*
- [[SurrealDB 3.0 Core Features and What's New]]
- [[SurrealQL Query Language Deep Dive]]
- [[SurrealDB Data Model Documents Graphs Relations]]
- [[SurrealML and AI Vector Capabilities]]
