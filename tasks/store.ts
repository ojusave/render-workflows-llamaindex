/**
 * Workflow task: persist all pipeline results into Postgres.
 * Writes classification metadata, parsed markdown, extracted fields,
 * and text chunks with embeddings for pgvector semantic search.
 */

import { task } from "@renderinc/sdk/workflows";
import {
  updateDocumentClassification,
  updateDocumentParsed,
  updateDocumentExtracted,
  insertChunk,
} from "../shared/db.js";
import { placeholderEmbedding } from "../shared/embedding.js";

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "1000", 10);
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || "200", 10);

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * Store all pipeline results into Postgres:
 * classification metadata, parsed content, extracted fields, and text chunks with embeddings.
 */
export const storeResults = task(
  {
    name: "store_results",
    plan: "standard",
    timeoutSeconds: 300,
    retry: { maxRetries: 2, waitDurationMs: 3000, backoffScaling: 2 },
  },
  async function storeResults(
    documentId: number,
    classification: { docType: string; confidence: number; reasoning: string },
    parsed: { markdown: string; text: string; pages: Array<{ pageNumber: number; markdown: string }> },
    extracted: { extractedData: Record<string, unknown>; schemaUsed: Record<string, unknown> }
  ): Promise<{ chunksStored: number }> {
    await updateDocumentClassification(
      documentId,
      classification.docType,
      classification.confidence,
      classification.reasoning
    );

    await updateDocumentParsed(documentId, parsed.markdown, parsed.text);

    await updateDocumentExtracted(documentId, extracted.extractedData);

    const textToChunk = parsed.text || parsed.markdown;
    const chunks = chunkText(textToChunk);

    for (let i = 0; i < chunks.length; i++) {
      const embedding = placeholderEmbedding(chunks[i]);
      const pageNumber = parsed.pages.length > 0
        ? parsed.pages[Math.min(i, parsed.pages.length - 1)].pageNumber
        : null;
      await insertChunk(documentId, chunks[i], embedding, pageNumber);
    }

    return { chunksStored: chunks.length };
  }
);
