/**
 * Postgres connection pool and all database operations.
 * Stores document metadata, parsed content, and extracted fields.
 * Semantic search handled by LlamaCloud managed pipelines (not pgvector).
 */

import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id            SERIAL PRIMARY KEY,
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
    // Existing DBs from before this column existed: CREATE TABLE IF NOT EXISTS does not add columns.
    await client.query(`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS llamacloud_file_id TEXT
    `);
  } finally {
    client.release();
  }
}

export async function insertDocument(filename: string): Promise<number> {
  const result = await pool.query(
    "INSERT INTO documents (filename) VALUES ($1) RETURNING id",
    [filename]
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

export async function listDocuments(): Promise<
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
     FROM documents ORDER BY created_at DESC`
  );
  return result.rows;
}

export async function getDocument(id: number) {
  const result = await pool.query("SELECT * FROM documents WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

export async function deleteDocument(id: number): Promise<boolean> {
  const result = await pool.query("DELETE FROM documents WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Deletes rows whose `created_at` is older than `retentionMinutes`. Returns rows removed. */
export async function purgeDocumentsOlderThan(retentionMinutes: number): Promise<number> {
  if (retentionMinutes <= 0) return 0;
  const result = await pool.query(
    `DELETE FROM documents
     WHERE created_at < NOW() - ($1::integer * INTERVAL '1 minute')`,
    [retentionMinutes]
  );
  return result.rowCount ?? 0;
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export { pool };
