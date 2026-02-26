/**
 * SurrealQL safety validator.
 *
 * Prevents dangerous DDL/admin operations from being executed via Code Mode tools.
 * Write operations (INSERT, UPDATE, etc.) are allowed only when explicitly opted in.
 */

/** Patterns that are never allowed — DDL and admin commands */
const BLOCKED_PATTERNS: RegExp[] = [
  /\bDROP\b/i,
  /\bDEFINE\b/i,
  /\bREMOVE\b/i,
  /\bKILL\b/i,
  /\bUSE\s+NS\b/i,
  /\bUSE\s+DB\b/i,
  /\bINFO\s+FOR\b/i,
];

/** Patterns that indicate a write operation */
const WRITE_PATTERNS: RegExp[] = [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bCREATE\b/i,
  /\bUPSERT\b/i,
  /\bRELATE\b/i,
  /\bDELETE\b/i,
];

export interface ValidationResult {
  valid: boolean;
  requiresWrite: boolean;
  errors: string[];
}

/**
 * Strip single-line comments (-- ...) and string literals ('...' and "...")
 * from SurrealQL so that blocked keywords inside comments or strings
 * don't trigger false positives.
 */
function stripCommentsAndStrings(surql: string): string {
  let result = "";
  let i = 0;

  while (i < surql.length) {
    // Single-line comment: -- to end of line
    if (surql[i] === "-" && surql[i + 1] === "-") {
      while (i < surql.length && surql[i] !== "\n") {
        i++;
      }
      continue;
    }

    // Single-quoted string
    if (surql[i] === "'") {
      i++; // skip opening quote
      while (i < surql.length && surql[i] !== "'") {
        if (surql[i] === "\\" && i + 1 < surql.length) {
          i += 2; // skip escaped char
        } else {
          i++;
        }
      }
      i++; // skip closing quote
      result += "''"; // placeholder so spacing stays intact
      continue;
    }

    // Double-quoted string
    if (surql[i] === '"') {
      i++; // skip opening quote
      while (i < surql.length && surql[i] !== '"') {
        if (surql[i] === "\\" && i + 1 < surql.length) {
          i += 2;
        } else {
          i++;
        }
      }
      i++; // skip closing quote
      result += '""';
      continue;
    }

    result += surql[i];
    i++;
  }

  return result;
}

/**
 * Validate a SurrealQL string for safety.
 *
 * @param surql - The SurrealQL query to validate
 * @param allowWrites - Whether write operations (INSERT, UPDATE, etc.) are permitted
 * @returns Validation result with errors if invalid
 */
export function validateSurql(surql: string, allowWrites = false): ValidationResult {
  const errors: string[] = [];
  const cleaned = stripCommentsAndStrings(surql);

  // Check for blocked patterns (always forbidden)
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cleaned)) {
      const match = cleaned.match(pattern);
      errors.push(`Blocked operation: ${match?.[0] ?? pattern.source}`);
    }
  }

  // Detect write operations
  let requiresWrite = false;
  for (const pattern of WRITE_PATTERNS) {
    if (pattern.test(cleaned)) {
      requiresWrite = true;
      if (!allowWrites) {
        const match = cleaned.match(pattern);
        errors.push(`Write operation not allowed: ${match?.[0] ?? pattern.source} (set allow_writes=true to permit)`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    requiresWrite,
    errors,
  };
}
