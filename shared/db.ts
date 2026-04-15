/**
 * Postgres connection pool and all database operations.
 * Creates the documents and document_chunks tables on first run,
 * enables pgvector, and builds an HNSW index for semantic search.
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
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
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
        status        TEXT NOT NULL DEFAULT 'processing',
        error         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id            SERIAL PRIMARY KEY,
        document_id   INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_text    TEXT NOT NULL,
        embedding     vector(1536),
        page_number   INTEGER,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chunks_embedding
      ON document_chunks USING hnsw (embedding vector_cosine_ops)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_status
      ON documents (status)
    `);
  } finally {
    client.release();
  }
}

export async function insertDocument(
  filename: string
): Promise<number> {
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
    `UPDATE documents
     SET doc_type = $2, confidence = $3, reasoning = $4
     WHERE id = $1`,
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

export async function updateDocumentError(
  id: number,
  error: string
): Promise<void> {
  await pool.query(
    "UPDATE documents SET status = 'failed', error = $2 WHERE id = $1",
    [id, error]
  );
}

export async function insertChunk(
  documentId: number,
  chunkText: string,
  embedding: number[],
  pageNumber: number | null
): Promise<void> {
  const embeddingStr = `[${embedding.join(",")}]`;
  await pool.query(
    `INSERT INTO document_chunks (document_id, chunk_text, embedding, page_number)
     VALUES ($1, $2, $3::vector, $4)`,
    [documentId, chunkText, embeddingStr, pageNumber]
  );
}

export async function searchDocuments(
  queryEmbedding: number[],
  limit = 10
): Promise<Array<{ document_id: number; chunk_text: string; score: number; filename: string; doc_type: string }>> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const result = await pool.query(
    `SELECT dc.document_id, dc.chunk_text,
            1 - (dc.embedding <=> $1::vector) AS score,
            d.filename, d.doc_type
     FROM document_chunks dc
     JOIN documents d ON d.id = dc.document_id
     ORDER BY dc.embedding <=> $1::vector
     LIMIT $2`,
    [embeddingStr, limit]
  );
  return result.rows;
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
  const result = await pool.query("SELECT * FROM documents WHERE id = $1", [
    id,
  ]);
  return result.rows[0] ?? null;
}

export async function deleteDocument(id: number): Promise<boolean> {
  const result = await pool.query("DELETE FROM documents WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export { pool };
