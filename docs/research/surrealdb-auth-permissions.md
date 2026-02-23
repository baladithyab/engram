# Authentication and Permissions

> SurrealDB's security model is built on a layered architecture: **system users** provide
> administrative access at different scopes, **record access** enables application-level
> authentication with custom logic, **JWT and bearer tokens** integrate with external identity
> providers, and **table/field permissions** enforce row-level security. The capabilities
> system adds a server-wide security layer that restricts what any user can do.

---

## Table of Contents

- [[#System Users]]
  - [[#User Hierarchy]]
  - [[#Roles (RBAC)]]
  - [[#DEFINE USER Syntax]]
  - [[#Signing In as a System User]]
- [[#Access Methods (DEFINE ACCESS)]]
  - [[#Record Access]]
  - [[#JWT Access]]
  - [[#Bearer Access]]
  - [[#The AUTHENTICATE Clause]]
  - [[#Duration Configuration]]
- [[#Permissions and Authorization]]
  - [[#Table Permissions]]
  - [[#Field Permissions]]
  - [[#Row-Level Security Patterns]]
  - [[#The $auth, $token, and $session Variables]]
- [[#Token and Session Management]]
  - [[#Token Lifecycle]]
  - [[#Refresh Tokens]]
  - [[#Grant Management (ACCESS Statement)]]
- [[#Capabilities System]]
  - [[#Capability Flags]]
  - [[#Guest Access]]
  - [[#Function and Network Restrictions]]
  - [[#Arbitrary Query Control]]
- [[#Security Best Practices]]
  - [[#Production Deployment Checklist]]
  - [[#Password Handling]]
  - [[#Token and Session Hardening]]
  - [[#Network and TLS]]
  - [[#Query Safety and XSS Prevention]]
- [[#Comparison with Other Databases]]

---

## System Users

System users are administrator-level accounts defined with `DEFINE USER`. They authenticate with a username and password and operate at one of three hierarchical levels.

### User Hierarchy

SurrealDB has three tiers of system users, each with decreasing scope:

| Level | Scope | Can Manage |
|-------|-------|------------|
| **Root** | Entire instance | All namespaces, databases, users, and data |
| **Namespace** | Single namespace | All databases within that namespace |
| **Database** | Single database | All tables, access methods, and data within that database |

A user at a higher level inherits access to everything at lower levels. A root user can query any namespace and database. A namespace user can query any database within their namespace but cannot see other namespaces.

### Roles (RBAC)

Each system user is assigned one or more built-in roles:

| Role | Permissions |
|------|-------------|
| `OWNER` | Full read/write on all resources at the user's level and below, **including** IAM resources (users, access methods) |
| `EDITOR` | Full read/write on all resources at the user's level and below, **excluding** IAM resources |
| `VIEWER` | Read-only access to all resources at the user's level and below |

All roles also grant corresponding permissions on child resources that support the `PERMISSIONS` clause.

### DEFINE USER Syntax

```surql
DEFINE USER [ OVERWRITE | IF NOT EXISTS ] @name
    ON [ ROOT | NAMESPACE | DATABASE ]
    [ PASSWORD @pass | PASSHASH @hash ]
    [ ROLES @roles ]
    [ DURATION
        [ FOR TOKEN @duration ]
        [ FOR SESSION @duration ]
    ]
    [ COMMENT @string ];
```

**Examples:**

```surql
-- Root-level owner
DEFINE USER admin ON ROOT PASSWORD 'super-secret-password!' ROLES OWNER;

-- Namespace-level editor with session limits
USE NS production;
DEFINE USER deployer ON NAMESPACE PASSWORD 'deploy-key-2024' ROLES EDITOR
    DURATION FOR TOKEN 5m, FOR SESSION 1h;

-- Database-level viewer with a comment
USE NS production DB analytics;
DEFINE USER dashboard ON DATABASE PASSWORD 'read-only-key' ROLES VIEWER
    COMMENT 'Used by the reporting dashboard';

-- Pre-hashed password (useful for automation)
DEFINE USER automation ON DATABASE PASSHASH '$argon2id$v=19$m=65536...' ROLES EDITOR;

-- Safe creation (no error if already exists)
DEFINE USER IF NOT EXISTS backup ON ROOT PASSWORD 'backup-pw' ROLES VIEWER;

-- Overwrite existing definition
DEFINE USER OVERWRITE deployer ON NAMESPACE PASSWORD 'new-key-2025' ROLES EDITOR;
```

**Who can create whom:**
- Root OWNER can create Root, Namespace, and Database users
- Namespace OWNER can create Namespace and Database users
- Database OWNER can create Database users only

### Signing In as a System User

**SurrealQL (from client SDK):**
```javascript
const db = new Surreal();
await db.connect('ws://localhost:8000/rpc');

// Sign in as a database user
await db.signin({
    namespace: 'production',
    database: 'analytics',
    username: 'dashboard',
    password: 'read-only-key'
});
```

**HTTP REST API:**
```bash
curl -X POST \
    -H "Accept: application/json" \
    -d '{"NS":"production", "DB":"analytics", "user":"dashboard", "pass":"read-only-key"}' \
    http://localhost:8000/signin
```

**HTTP Basic Auth (for quick access):**
```bash
curl -X POST \
    -u "root:root-password" \
    -H "Accept: application/json" \
    -H "NS: production" \
    -H "DB: analytics" \
    -d "SELECT * FROM user LIMIT 10" \
    http://localhost:8000/sql
```

---

## Access Methods (DEFINE ACCESS)

The `DEFINE ACCESS` statement (available since v2.0.0) configures how users authenticate and what tokens they receive. It replaces the older `DEFINE SCOPE` and `DEFINE TOKEN` statements.

There are three access types: **Record**, **JWT**, and **Bearer**.

### Record Access

Record access turns SurrealDB into a "web database" where application end-users authenticate directly. Custom signup/signin logic is defined in SurrealQL, and the authenticated identity maps to a database record.

**Full syntax:**

```surql
DEFINE ACCESS [ OVERWRITE | IF NOT EXISTS ] @name
    ON DATABASE TYPE RECORD
    [ SIGNUP @expression ]
    [ SIGNIN @expression ]
    [ WITH JWT
        [ ALGORITHM @algorithm KEY @key | URL @url ]
        [ WITH ISSUER KEY @key ]
    ]
    [ WITH REFRESH ]
    [ AUTHENTICATE @expression ]
    [ DURATION
        [ FOR GRANT @duration ]
        [ FOR TOKEN @duration ]
        [ FOR SESSION @duration ]
    ]
    [ COMMENT @string ];
```

**Basic example -- email/password authentication:**

```surql
-- Define the user table with schema enforcement
DEFINE TABLE user SCHEMAFULL
    PERMISSIONS
        FOR select, update WHERE id = $auth.id
        FOR delete NONE
        FOR create NONE;

DEFINE FIELD name ON user TYPE string;
DEFINE FIELD email ON user TYPE string ASSERT string::is::email($value);
DEFINE FIELD password ON user TYPE string;
DEFINE INDEX email ON user FIELDS email UNIQUE;

-- Define the record access method
DEFINE ACCESS account ON DATABASE TYPE RECORD
    SIGNUP (
        CREATE user CONTENT {
            name: $name,
            email: $email,
            password: crypto::argon2::generate($password)
        }
    )
    SIGNIN (
        SELECT * FROM user
        WHERE email = $email
        AND crypto::argon2::compare(password, $password)
    )
    DURATION FOR TOKEN 15m, FOR SESSION 12h;
```

**Signing up (JavaScript SDK):**

```javascript
const token = await db.signup({
    namespace: 'production',
    database: 'app',
    access: 'account',
    variables: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'VerySecurePassword!'
    }
});
```

**Signing in (HTTP):**

```bash
curl -X POST \
    -H "Accept: application/json" \
    -d '{
        "NS": "production",
        "DB": "app",
        "AC": "account",
        "email": "jane@example.com",
        "password": "VerySecurePassword!"
    }' \
    http://localhost:8000/signin
```

The `SIGNUP` clause receives variables from the client and must return a record (typically via `CREATE`). The `SIGNIN` clause must return the matching record (typically via `SELECT`). The returned record's ID becomes `$auth.id` for subsequent queries.

### JWT Access

JWT access methods authenticate users via externally- or internally-issued JSON Web Tokens. When a token is verified, SurrealDB trusts its claims and grants access accordingly.

**Key point:** Access provided by JWT access methods at the namespace or database level is equivalent to system user access at that level.

**Supported algorithms:**
- HMAC: `HS256`, `HS384`, `HS512` (symmetric, shared secret)
- RSA: `RS256`, `RS384`, `RS512` (asymmetric, public/private key)
- ECDSA: `ES256`, `ES384`, `ES512` (asymmetric, elliptic curve)
- PSS: `PS256`, `PS384`, `PS512` (asymmetric, RSA-PSS)
- EdDSA: `EDDSA` (asymmetric, Edwards curve)

**Symmetric key example (HS512):**

```surql
DEFINE ACCESS api_token ON DATABASE TYPE JWT
    ALGORITHM HS512
    KEY 'your-256-bit-secret-key-here-must-be-long-enough'
    DURATION FOR SESSION 2h;
```

**Asymmetric key example (RS256):**

```surql
DEFINE ACCESS external_auth ON DATABASE TYPE JWT
    ALGORITHM RS256
    KEY "-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1LfV...
-----END PUBLIC KEY-----"
    DURATION FOR SESSION 4h;
```

**JWKS URL example (for providers like Auth0, Cognito, Keycloak):**

```surql
DEFINE ACCESS auth0 ON DATABASE TYPE JWT
    URL "https://your-tenant.auth0.com/.well-known/jwks.json"
    DURATION FOR SESSION 2h;
```

> JWKS keys are cached for 12 hours. If a new `kid` header is encountered, SurrealDB
> refreshes the keyset (at most once per 5 minutes). Requires `--allow-net` with the
> provider's hostname.

**JWT access at different levels:**

```surql
-- Root-level JWT (grants root-equivalent access)
DEFINE ACCESS root_api ON ROOT TYPE JWT ALGORITHM HS512 KEY 'secret';
-- Required payload: {"exp": ..., "ac": "root_api"}

-- Namespace-level JWT
USE NS production;
DEFINE ACCESS ns_api ON NAMESPACE TYPE JWT ALGORITHM HS512 KEY 'secret';
-- Required payload: {"exp": ..., "ac": "ns_api", "ns": "production"}

-- Database-level JWT
USE NS production DB app;
DEFINE ACCESS db_api ON DATABASE TYPE JWT ALGORITHM HS512 KEY 'secret';
-- Required payload: {"exp": ..., "ac": "db_api", "ns": "production", "db": "app"}
```

**Required JWT claims:**
| Claim | Required | Description |
|-------|----------|-------------|
| `exp` | Yes | Expiration time (Unix timestamp) |
| `ac` | Yes | Access method name |
| `ns` | For NS/DB level | Namespace name |
| `db` | For DB level | Database name |
| `id` | No | Record identifier (makes `$auth` available) |
| `rl` | No | Array of roles: `["Viewer"]`, `["Editor"]`, `["Owner"]` |
| `nbf` | No | "Not before" time |

Claims are case-insensitive and can optionally be namespaced with `https://surrealdb.com` (e.g., `https://surrealdb.com/ns`).

### Bearer Access

Bearer access methods generate opaque API keys (bearer grants) for system users or record users. Unlike JWTs, bearer keys are randomly generated strings that SurrealDB stores and validates internally.

**For system users:**

```surql
-- Define the access method
DEFINE ACCESS api ON DATABASE TYPE BEARER FOR USER
    DURATION FOR GRANT 30d, FOR TOKEN 15m, FOR SESSION 12h;

-- Define a system user to receive the grant
DEFINE USER automation ON DATABASE PASSWORD 'secret' ROLES VIEWER;

-- Generate a bearer grant
ACCESS api GRANT FOR USER automation;
-- Returns: { grant: { id: "...", key: "surreal-bearer-..." }, subject: { user: "automation" } }
```

**For record users:**

```surql
-- Create a record user
CREATE user:1 CONTENT { name: "Service Account" };

-- Define bearer access for records
DEFINE ACCESS service_api ON DATABASE TYPE BEARER FOR RECORD
    DURATION FOR GRANT 10d, FOR TOKEN 1m, FOR SESSION 6h;

-- Generate a grant for the record
ACCESS service_api GRANT FOR RECORD user:1;
```

**Signing in with a bearer key:**

```javascript
await db.signin({
    namespace: 'production',
    database: 'app',
    access: 'api',
    variables: {
        key: 'surreal-bearer-BNb2pS0GmaJz-5eTfQ5uEu8jbRb3oblqVMAt8'
    }
});
```

**Use cases:** Service-to-service authentication, CI/CD pipelines, automation scripts, API integrations where you need revocable credentials without password sharing.

### The AUTHENTICATE Clause

The `AUTHENTICATE` clause runs custom logic after signin, signup, or token verification. It can modify the authenticated identity, validate additional conditions, or perform auditing.

**External provider integration (map JWT claims to local records):**

```surql
DEFINE ACCESS sso ON DATABASE TYPE RECORD
    WITH JWT ALGORITHM HS512 KEY 'shared-secret'
    AUTHENTICATE {
        -- If already authenticated as a record, keep that identity
        IF $auth.id {
            RETURN $auth.id;
        }
        -- Otherwise, look up the user by their email claim
        ELSE IF $token.email {
            RETURN SELECT * FROM user WHERE email = $token.email;
        };
    };
```

**User validation (check if account is active):**

```surql
DEFINE ACCESS account ON DATABASE TYPE RECORD
    SIGNUP ( CREATE user SET email = $email, pass = crypto::argon2::generate($pass) )
    SIGNIN ( SELECT * FROM user WHERE email = $email AND crypto::argon2::compare(pass, $pass) )
    AUTHENTICATE {
        IF !$auth.enabled {
            THROW "This account has been disabled";
        };
        RETURN $auth;
    };
```

**Token auditing and revocation checking:**

```surql
DEFINE ACCESS secure_account ON DATABASE TYPE RECORD
    SIGNUP ( CREATE user SET email = $email, pass = crypto::argon2::generate($pass) )
    SIGNIN ( SELECT * FROM user WHERE email = $email AND crypto::argon2::compare(pass, $pass) )
    AUTHENTICATE {
        -- Check if this specific token has been revoked
        IF type::record("token", $token.jti).revoked = true {
            THROW "This token has been revoked";
        };
        -- Log the token usage for auditing
        INSERT INTO token { id: $token.jti, exp: $token.exp, revoked: false };
        CREATE audit CONTENT { token: $token.jti, time: time::now() };
        RETURN $auth;
    };
```

**JWT claim validation (issuer and audience checks):**

```surql
DEFINE ACCESS verified_jwt ON DATABASE TYPE JWT
    ALGORITHM HS512 KEY 'secret'
    AUTHENTICATE {
        IF $token.iss != "my-auth-server" {
            THROW "Invalid token issuer";
        };
        IF type::is::array($token.aud) {
            IF "my-app" NOT IN $token.aud {
                THROW "Invalid token audience";
            };
        } ELSE {
            IF $token.aud IS NOT "my-app" {
                THROW "Invalid token audience";
            };
        };
    }
    DURATION FOR SESSION 2h;
```

### Duration Configuration

Access methods support three independent duration settings:

| Duration | Applies To | Controls | Default |
|----------|-----------|----------|---------|
| `FOR GRANT` | Bearer access | How long the bearer key itself remains valid | 30 days |
| `FOR TOKEN` | Record, JWT | Validity period of the JWT after authentication | Varies |
| `FOR SESSION` | All types | How long the authenticated session persists | `NONE` (no expiration) |

```surql
DEFINE ACCESS account ON DATABASE TYPE RECORD
    SIGNUP ( ... )
    SIGNIN ( ... )
    WITH REFRESH
    DURATION
        FOR GRANT 15d,    -- refresh token valid for 15 days
        FOR TOKEN 1m,     -- JWT valid for 1 minute
        FOR SESSION 12h;  -- session valid for 12 hours
```

The token authenticates the session, but they expire independently. A short-lived token combined with a longer session means the user authenticates once and stays connected without needing to re-present the token.

---

## Permissions and Authorization

Permissions in SurrealDB are enforced at query time based on the authenticated user's level and role. System users with appropriate roles bypass table/field permissions. Record users and guests are always subject to permissions.

### Table Permissions

The `PERMISSIONS` clause on `DEFINE TABLE` controls which records a user can access:

```surql
DEFINE TABLE @name
    PERMISSIONS [ NONE | FULL
        | FOR select @expression
        | FOR create @expression
        | FOR update @expression
        | FOR delete @expression
    ];
```

- **`NONE`** -- No access (default for new tables)
- **`FULL`** -- Unrestricted access
- **`FOR <operation> WHERE <condition>`** -- Conditional access per operation

**Example -- blog posts with owner and admin access:**

```surql
DEFINE TABLE post SCHEMALESS
    PERMISSIONS
        FOR select
            WHERE published = true
            OR user = $auth.id
        FOR create, update
            WHERE user = $auth.id
        FOR delete
            WHERE user = $auth.id
            OR $auth.admin = true;
```

**Example -- relation table permissions:**

```surql
DEFINE TABLE assigned_to SCHEMAFULL TYPE RELATION IN tag OUT sticky
    PERMISSIONS
        FOR create, select, update, delete
            WHERE in.owner == $auth.id
            AND out.author == $auth.id;
```

This ensures users can only create/read/modify/delete relations between tags they own and stickies they authored.

**Default behavior:**
```surql
-- Implicitly creates a table with PERMISSIONS NONE
CREATE some_table SET value = 42;

-- Record users and guests CANNOT access this table
-- System users (root, ns, db) CAN access it regardless
```

### Field Permissions

Field-level permissions provide column-level access control, independent of table permissions:

```surql
DEFINE FIELD @name ON [ TABLE ] @table
    [ TYPE @type ]
    [ PERMISSIONS [ NONE | FULL
        | FOR select @expression
        | FOR create @expression
        | FOR update @expression
    ] ];
```

> Field permissions do not support `FOR delete` -- deletion applies to entire records,
> not individual fields.

**Default:** Fields have `FULL` permissions unless specified otherwise.

**Example -- protecting sensitive fields:**

```surql
DEFINE TABLE user SCHEMAFULL
    PERMISSIONS
        FOR select WHERE id = $auth.id OR $auth.role = "admin"
        FOR create NONE
        FOR update WHERE id = $auth.id
        FOR delete NONE;

-- Public fields
DEFINE FIELD name ON user TYPE string;
DEFINE FIELD avatar ON user TYPE option<string>;

-- Email visible only to the user themselves or admins
DEFINE FIELD email ON user TYPE string
    PERMISSIONS
        FOR select WHERE id = $auth.id OR $auth.role = "admin"
        FOR update WHERE id = $auth.id;

-- Password hash never readable, only settable on create/update
DEFINE FIELD password ON user TYPE string
    PERMISSIONS
        FOR select NONE
        FOR create, update FULL;

-- Internal field - not accessible to record users
DEFINE FIELD internal_score ON user TYPE float
    PERMISSIONS NONE;
```

### Row-Level Security Patterns

Row-level security (RLS) is implemented through `WHERE` clauses in table permissions. Common patterns:

**1. Owner-based access:**
```surql
DEFINE TABLE document SCHEMALESS
    PERMISSIONS
        FOR select, update, delete WHERE owner = $auth.id
        FOR create FULL;
```

**2. Role-based access:**
```surql
DEFINE TABLE admin_log SCHEMALESS
    PERMISSIONS
        FOR select WHERE $auth.role = "admin"
        FOR create WHERE $auth.role = "admin"
        FOR update, delete NONE;
```

**3. Organization/tenant isolation (multi-tenancy):**
```surql
DEFINE TABLE project SCHEMALESS
    PERMISSIONS
        FOR select WHERE org = $auth.org
        FOR create WHERE org = $auth.org
        FOR update WHERE org = $auth.org AND (
            owner = $auth.id OR $auth.role = "org_admin"
        )
        FOR delete WHERE org = $auth.org AND $auth.role = "org_admin";
```

**4. Status-based visibility:**
```surql
DEFINE TABLE article SCHEMALESS
    PERMISSIONS
        FOR select WHERE status = "published"
            OR author = $auth.id
            OR $auth.role = "editor"
        FOR create WHERE $auth.role IN ["author", "editor"]
        FOR update WHERE author = $auth.id OR $auth.role = "editor"
        FOR delete WHERE $auth.role = "editor";
```

**5. Time-based access:**
```surql
DEFINE TABLE exam SCHEMALESS
    PERMISSIONS
        FOR select WHERE
            time::now() > start_time
            AND (
                time::now() < end_time
                OR $auth.role = "instructor"
            )
        FOR create, update WHERE $auth.role = "instructor"
        FOR delete NONE;
```

**6. Graph traversal permissions (relation tables):**
```surql
DEFINE TABLE follows SCHEMAFULL TYPE RELATION IN user OUT user
    PERMISSIONS
        FOR create WHERE in = $auth.id       -- can only follow as yourself
        FOR delete WHERE in = $auth.id       -- can only unfollow as yourself
        FOR select FULL;                     -- anyone can see who follows whom
```

### The $auth, $token, and $session Variables

Three special variables are available in permission expressions and queries:

**`$auth`** -- The authenticated record (record users only):
```surql
-- Contains all fields of the authenticated user's record
$auth.id       -- e.g., user:abc123
$auth.name     -- e.g., "Jane Doe"
$auth.email    -- e.g., "jane@example.com"
$auth.role     -- e.g., "admin" (custom field)
$auth.org      -- e.g., org:acme (custom field)
```

**`$token`** -- The JWT claims:
```surql
$token.ns      -- Namespace
$token.db      -- Database
$token.ac      -- Access method
$token.id      -- Record ID (if present)
$token.exp     -- Expiration time
$token.iat     -- Issued at time
$token.nbf     -- Not before time
$token.iss     -- Issuer
$token.jti     -- JWT ID
-- Plus any custom claims from the token
$token.email   -- Custom claim
$token.groups  -- Custom claim
```

**`$session`** -- Session metadata:
```surql
$session.ip    -- Client IP address
$session.ns    -- Current namespace
$session.db    -- Current database
$session.ac    -- Access method used
$session.exp   -- Session expiration
$session.or    -- Origin header
```

---

## Token and Session Management

### Token Lifecycle

1. **Authentication** -- User provides credentials (password, bearer key, or JWT)
2. **Verification** -- SurrealDB validates credentials and runs `AUTHENTICATE` clause if defined
3. **Token Issuance** -- SurrealDB generates a JWT (for record/JWT access) or validates the external JWT
4. **Session Creation** -- A session is established with the authenticated identity
5. **Expiration** -- Token and session expire independently based on `DURATION` settings

The token authenticates the session. Once a session is established, the token's own expiration does not terminate the session. The session has its own independent lifetime.

### Refresh Tokens

The `WITH REFRESH` clause (experimental as of v2.x) enables refresh token support for record access methods. Refresh tokens are opaque bearer keys (not JWTs) that can be used to obtain new access tokens without re-entering credentials.

```surql
DEFINE ACCESS account ON DATABASE TYPE RECORD
    SIGNUP ( CREATE user SET email = $email, pass = crypto::argon2::generate($pass) )
    SIGNIN ( SELECT * FROM user WHERE email = $email AND crypto::argon2::compare(pass, $pass) )
    WITH REFRESH
    DURATION FOR GRANT 15d, FOR TOKEN 1m, FOR SESSION 12h;
```

**How refresh works:**
1. User signs in and receives both a `token` (JWT) and a `refresh` (bearer key)
2. When the JWT expires, the client presents the refresh token to get a new JWT
3. The old refresh token is automatically revoked and a new one is issued (rotation)
4. Refresh tokens can be audited and manually revoked via the `ACCESS` statement

**Signup response with refresh:**
```json
{
    "token": "eyJhbGciOiJIUzUxMiIs...",
    "refresh": "surreal-bearer-Abc123..."
}
```

### Grant Management (ACCESS Statement)

The `ACCESS` statement (v2.2.0+, experimental) manages bearer grants:

**Generate a grant:**
```surql
ACCESS api GRANT FOR USER automation;
ACCESS api GRANT FOR RECORD user:1;
```

**Inspect grants (keys are redacted after creation):**
```surql
-- Show a specific grant
ACCESS api SHOW GRANT JdvDFKMCVYoM;

-- Show all grants
ACCESS api SHOW ALL;

-- Filter grants
ACCESS api SHOW WHERE subject.record.name = "tobie";
```

**Revoke a grant (invalidate but keep record):**
```surql
-- Revoke specific grant
ACCESS api REVOKE GRANT NJ2I2d7OXxN9;

-- Revoke all grants for a subject
ACCESS api REVOKE WHERE subject.record.name = "tobie";

-- Revoke all grants
ACCESS api REVOKE ALL;
```

**Purge old grants (permanently delete):**
```surql
-- Remove expired grants
ACCESS api PURGE EXPIRED;

-- Remove revoked grants older than 90 days
ACCESS api PURGE REVOKED FOR 90d;

-- Remove all invalid grants older than 1 year
ACCESS api PURGE EXPIRED, REVOKED FOR 1y;
```

---

## Capabilities System

The capabilities system is a server-level security layer that restricts what any user (authenticated or not) can do. It is configured via CLI flags when starting `surreal start`.

**Core principle:** SurrealDB is **secure by default**. Most powerful features are disabled unless explicitly allowed. Specific rules override general rules, and denies always win over allows at the same specificity level.

### Capability Flags

| Flag | Description | Default |
|------|-------------|---------|
| `-A, --allow-all` | Allow all capabilities (except experimental) | Off |
| `-D, --deny-all` | Deny all capabilities | Off |
| `--allow-scripting` | Allow embedded scripting functions | Off |
| `--deny-scripting` | Deny embedded scripting | On |
| `--allow-guests` | Allow unauthenticated access | Off |
| `--deny-guests` | Deny unauthenticated access | On |
| `--allow-funcs [targets]` | Allow specific functions | Off |
| `--deny-funcs [targets]` | Deny specific functions | -- |
| `--allow-net [targets]` | Allow outbound network | Off |
| `--deny-net [targets]` | Deny outbound network | -- |
| `--deny-arbitrary-query [groups]` | Deny arbitrary queries for user groups | -- |
| `--allow-experimental [features]` | Enable experimental features | Off |
| `--no-identification-headers` | Hide server version in HTTP headers | Off |

### Guest Access

```bash
# Allow unauthenticated users to query (subject to PERMISSIONS)
surreal start --allow-guests

# Guests can only see tables with permissive PERMISSIONS:
# DEFINE TABLE public_data PERMISSIONS FOR select FULL;
# DEFINE TABLE private_data PERMISSIONS NONE;  -- blocked for guests
```

### Function and Network Restrictions

```bash
# Production: deny all, selectively allow
surreal start --deny-all \
    --allow-funcs "array,string,crypto::argon2,type,time,math,parse" \
    --allow-net "api.example.com:443,auth.example.com:443"

# Allow all functions except dangerous ones
surreal start --allow-funcs --deny-funcs "http,crypto::md5,crypto::sha1"

# Block private network access
surreal start --allow-net \
    --deny-net "127.0.0.1,localhost,10.0.0.0/8,192.168.0.0/16,172.16.0.0/12"
```

**Precedence examples:**
- `--deny-all --allow-scripting` -- Denies everything except scripting
- `--allow-all --deny-net` -- Allows everything except network access
- `--allow-funcs --deny-funcs crypto::md5` -- All functions allowed except `crypto::md5`
- `--deny-funcs crypto --allow-funcs crypto::md5` -- Deny wins; `crypto::md5` is denied (same specificity)

### Arbitrary Query Control

Since v2.2.0, you can restrict which user groups can run arbitrary queries:

```bash
# Only system users can run arbitrary queries; record and guest users cannot
surreal start --deny-arbitrary-query guest,record

# Combine with DEFINE API for controlled record user access
```

This affects `/sql`, `/key`, `/graphql` HTTP endpoints and RPC methods like `query`, `select`, `create`, `update`, `delete`.

---

## Security Best Practices

### Production Deployment Checklist

1. **Start with `--deny-all`** and explicitly allow only what your application needs
2. **Set explicit session durations** -- Default is no expiration; set `DURATION FOR SESSION` to hours, not days
3. **Use short token lifetimes** -- `DURATION FOR TOKEN 15m` or shorter
4. **Enable TLS** -- Via `--web-crt` and `--web-key` flags, or terminate TLS at a reverse proxy
5. **Restrict network exposure** -- Bind to internal interfaces or deploy behind a firewall
6. **Hide server identity** -- Use `--no-identification-headers` to prevent version fingerprinting
7. **Create users at the lowest level** with the minimum required role
8. **Separate WebSocket connections** for different users (do not share connections)
9. **Track published vulnerabilities** at [surrealdb/surrealdb security advisories](https://github.com/surrealdb/surrealdb/security/advisories)

### Password Handling

```surql
-- CORRECT: Use strong password hashing
DEFINE ACCESS account ON DATABASE TYPE RECORD
    SIGNUP (
        CREATE user SET
            email = $email,
            password = crypto::argon2::generate($password)
    )
    SIGNIN (
        SELECT * FROM user
        WHERE email = $email
        AND crypto::argon2::compare(password, $password)
    );

-- Supported hashing functions (in order of preference):
-- crypto::argon2::generate() / crypto::argon2::compare()
-- crypto::bcrypt::generate()  / crypto::bcrypt::compare()
-- crypto::scrypt::generate()  / crypto::scrypt::compare()
-- crypto::pbkdf2::generate()  / crypto::pbkdf2::compare()

-- WRONG: Never use general hash functions for passwords
-- crypto::md5(), crypto::sha1(), crypto::sha256(), crypto::sha512()
```

**Store password hashes in a separate table** with restrictive permissions for defense in depth:

```surql
DEFINE TABLE user SCHEMAFULL
    PERMISSIONS FOR select, update WHERE id = $auth.id;

DEFINE TABLE user_credential SCHEMAFULL
    PERMISSIONS NONE;  -- Never accessible to record users

DEFINE FIELD user ON user_credential TYPE record<user>;
DEFINE FIELD hash ON user_credential TYPE string;
```

### Token and Session Hardening

- **Prefer asymmetric algorithms** (RS256, ES256, PS256) over symmetric (HS256, HS512) for JWT access methods
- **Use JWKS URLs** for key rotation capability: `TYPE JWT URL "https://.../.well-known/jwks.json"`
- **Set explicit durations** -- Do not rely on defaults:
  ```surql
  DURATION FOR TOKEN 15m, FOR SESSION 4h
  ```
- **Do not store tokens in cookies** -- SurrealDB does not support cookie-based auth; use in-memory storage with XSS protections
- **Use the AUTHENTICATE clause** to validate token claims (issuer, audience) and check revocation

### Network and TLS

```bash
# Enable TLS directly
surreal start \
    --web-crt /path/to/cert.pem \
    --web-key /path/to/key.pem \
    --bind 0.0.0.0:8000

# Or terminate TLS at a reverse proxy (nginx, Caddy, ALB)
# and bind SurrealDB to localhost only
surreal start --bind 127.0.0.1:8000
```

**Encryption at rest:** Use disk-level encryption (LUKS, BitLocker) or cloud provider encryption. If using TiKV as the storage backend, TiKV supports its own encryption layer.

### Query Safety and XSS Prevention

**Always use parameterized queries (prevent SQL injection):**

```javascript
// CORRECT: Parameter binding
await db.query('SELECT * FROM user WHERE email = $email', {
    email: userInput
});

// WRONG: String concatenation
await db.query(`SELECT * FROM user WHERE email = '${userInput}'`);
```

**Sanitize user-generated content before rendering:**

```surql
-- Encode HTML entities (safer -- prevents all HTML)
string::html::encode($user_content)

-- Sanitize HTML (allows safe HTML tags, strips dangerous ones)
string::html::sanitize($user_content)
```

---

## Comparison with Other Databases

| Feature | SurrealDB | PostgreSQL | MongoDB | Firebase |
|---------|-----------|------------|---------|----------|
| **Built-in user auth** | Yes (DEFINE USER, DEFINE ACCESS RECORD) | Yes (CREATE ROLE) | Yes (db.createUser) | Yes (Firebase Auth) |
| **Row-level security** | Yes (PERMISSIONS WHERE) | Yes (RLS policies) | Partial (field-level in aggregation) | Yes (Security Rules) |
| **Field-level permissions** | Yes (DEFINE FIELD PERMISSIONS) | Via views/column privileges | Partial (field projection) | Yes (Security Rules) |
| **JWT integration** | Yes (DEFINE ACCESS TYPE JWT, JWKS) | Via extensions (pgJWT) | Via Atlas App Services | Built-in |
| **Custom auth logic** | Yes (SIGNUP/SIGNIN expressions) | Via functions/triggers | Via Atlas functions | Via Cloud Functions |
| **API keys / bearer tokens** | Yes (DEFINE ACCESS TYPE BEARER) | No (use external tools) | Via Atlas API keys | Via service accounts |
| **Refresh tokens** | Yes (WITH REFRESH, experimental) | No (external) | Via Atlas | Built-in |
| **Capability restrictions** | Yes (CLI flags) | Via pg_hba.conf, roles | Via network/role config | Via IAM rules |
| **Multi-tenant isolation** | Via namespaces + permissions | Via schemas + RLS | Via separate databases | Via projects |
| **Direct client-to-DB auth** | Yes (designed for it) | Not recommended | Not recommended | Yes (designed for it) |

**SurrealDB's distinctive strengths:**
- Designed for direct client-to-database connections (like Firebase) while supporting server-side use
- Authentication logic (signup/signin) defined in the query language itself, not external services
- Three-tier namespace hierarchy (root > namespace > database) provides natural multi-tenancy
- Bearer access methods with built-in grant lifecycle management (issue, audit, revoke, purge)
- The `AUTHENTICATE` clause provides a hook for custom validation on every authentication event

**Trade-offs:**
- Newer ecosystem with fewer battle-tested security audits compared to PostgreSQL
- Some features (refresh tokens, bearer access) are still marked experimental
- No built-in MFA -- must be implemented at the application layer or via an external identity provider
- Token storage guidance recommends against cookies, limiting some traditional web app patterns

---

## Related Pages

- [[Core Features and Whats New]] -- Overview of SurrealDB 3.0 features
- [[SurrealQL Query Language]] -- Full query language reference
- [[Data Model]] -- Document, graph, and relation modeling
- [[Advanced Features]] -- Functions, analyzers, indexes
- [[SDKs and Deployment]] -- Client libraries and deployment options
