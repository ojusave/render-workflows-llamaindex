/**
 * Postgres connection pool and all database operations.
 * Stores document metadata, parsed content, and extracted fields.
 * Semantic search handled by LlamaCloud managed pipelines (not pgvector).
 *
 * Sessions: Each visitor gets an ephemeral session with isolated data.
 * Sessions and their documents auto-expire after SESSION_LIFETIME_MINUTES.
 */

import pg from "pg";
import crypto from "crypto";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

/** Session lifetime in minutes (default 15 for demo). */
export const SESSION_LIFETIME_MINUTES = parseInt(
  process.env.SESSION_LIFETIME_MINUTES || "15",
  10
);

export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    // Sessions table for ephemeral demo access
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id            SERIAL PRIMARY KEY,
        token         TEXT NOT NULL UNIQUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at    TIMESTAMPTZ NOT NULL
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at)
    `);

    // Documents table with session_id foreign key
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id            SERIAL PRIMARY KEY,
        session_id    INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
        filename      TEXT NOT NULL,
        doc_type      TEXT,
        confidence    REAL,
        reasoning     TEXT,
        markdown      TEXT,
        raw_text      TEXT,
        structured_data JSONB,
        llamacloud_file_id TEXT,
        status        TEXT NOT NULL DEFAULT 'processing',
        error         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_status
      ON documents (status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_session_id
      ON documents (session_id)
    `);
    // Existing DBs from before these columns existed
    await client.query(`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS llamacloud_file_id TEXT
    `);
    await client.query(`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE
    `);
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session operations
// ─────────────────────────────────────────────────────────────────────────────

export interface Session {
  id: number;
  token: string;
  created_at: Date;
  expires_at: Date;
}

/** Create a new ephemeral session, returns the token. */
export async function createSession(): Promise<Session> {
  const token = crypto.randomUUID();
  const result = await pool.query(
    `INSERT INTO sessions (token, expires_at)
     VALUES ($1, NOW() + ($2::integer * INTERVAL '1 minute'))
     RETURNING id, token, created_at, expires_at`,
    [token, SESSION_LIFETIME_MINUTES]
  );
  return result.rows[0];
}

/** Get session by token, returns null if not found or expired. */
export async function getSessionByToken(token: string): Promise<Session | null> {
  const result = await pool.query(
    `SELECT id, token, created_at, expires_at
     FROM sessions
     WHERE token = $1 AND expires_at > NOW()`,
    [token]
  );
  return result.rows[0] ?? null;
}

/** Delete expired sessions (CASCADE deletes their documents). */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM sessions WHERE expires_at < NOW()`
  );
  return result.rowCount ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Document operations (session-scoped)
// ─────────────────────────────────────────────────────────────────────────────

export async function insertDocument(sessionId: number, filename: string): Promise<number> {
  const result = await pool.query(
    "INSERT INTO documents (session_id, filename) VALUES ($1, $2) RETURNING id",
    [sessionId, filename]
  );
  return result.rows[0].id;
}

export async function updateDocumentClassification(
  id: number,
  docType: string,
  confidence: number,
  reasoning: string
): Promise<void> {
  await pool.query(
    `UPDATE documents SET doc_type = $2, confidence = $3, reasoning = $4 WHERE id = $1`,
    [id, docType, confidence, reasoning]
  );
}

export async function updateDocumentParsed(
  id: number,
  markdown: string,
  rawText: string
): Promise<void> {
  await pool.query(
    "UPDATE documents SET markdown = $2, raw_text = $3 WHERE id = $1",
    [id, markdown, rawText]
  );
}

export async function updateDocumentExtracted(
  id: number,
  structuredData: Record<string, unknown>
): Promise<void> {
  await pool.query(
    "UPDATE documents SET structured_data = $2, status = 'completed' WHERE id = $1",
    [id, JSON.stringify(structuredData)]
  );
}

export async function updateDocumentFileId(
  id: number,
  llamacloudFileId: string
): Promise<void> {
  await pool.query(
    "UPDATE documents SET llamacloud_file_id = $2 WHERE id = $1",
    [id, llamacloudFileId]
  );
}

export async function updateDocumentError(
  id: number,
  error: string
): Promise<void> {
  await pool.query(
    "UPDATE documents SET status = 'failed', error = $2 WHERE id = $1",
    [id, error]
  );
}

export async function listDocuments(sessionId: number): Promise<
  Array<{
    id: number;
    filename: string;
    doc_type: string | null;
    confidence: number | null;
    status: string;
    structured_data: Record<string, unknown> | null;
    created_at: string;
  }>
> {
  const result = await pool.query(
    `SELECT id, filename, doc_type, confidence, status, structured_data, created_at
     FROM documents WHERE session_id = $1 ORDER BY created_at DESC`,
    [sessionId]
  );
  return result.rows;
}

export async function getDocument(sessionId: number, id: number) {
  const result = await pool.query(
    "SELECT * FROM documents WHERE id = $1 AND session_id = $2",
    [id, sessionId]
  );
  return result.rows[0] ?? null;
}

export async function deleteDocument(sessionId: number, id: number): Promise<boolean> {
  const result = await pool.query(
    "DELETE FROM documents WHERE id = $1 AND session_id = $2",
    [id, sessionId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export { pool };
