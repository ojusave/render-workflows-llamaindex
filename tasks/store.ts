/**
 * Workflow task: persist pipeline results into Postgres and index
 * the parsed text in a LlamaCloud managed pipeline for semantic search.
 */

import path from "path";
import { task } from "@renderinc/sdk/workflows";
import {
  updateDocumentClassification,
  updateDocumentParsed,
  updateDocumentExtracted,
  updateDocumentFileId,
} from "../shared/db.js";
import { getLlamaClient } from "../shared/llama-client.js";

const PIPELINE_ID = process.env.LLAMACLOUD_PIPELINE_ID;

export const storeResults = task(
  {
    name: "store_results",
    plan: "standard",
    timeoutSeconds: 300,
    retry: { maxRetries: 2, waitDurationMs: 3000, backoffScaling: 2 },
  },
  async function storeResults(
    documentId: number,
    fileId: string,
    classification: { docType: string; confidence: number; reasoning: string },
    parsed: { markdown: string; text: string; pages: Array<{ pageNumber: number; markdown: string }> },
    extracted: { extractedData: Record<string, unknown>; schemaUsed: Record<string, unknown> },
    filename: string
  ): Promise<{ indexed: boolean }> {
    await updateDocumentClassification(
      documentId,
      classification.docType,
      classification.confidence,
      classification.reasoning
    );

    await updateDocumentParsed(documentId, parsed.markdown, parsed.text);
    await updateDocumentExtracted(documentId, extracted.extractedData);
    await updateDocumentFileId(documentId, fileId);

    if (PIPELINE_ID) {
      const textToIndex = (parsed.text || parsed.markdown || "").trim();
      if (textToIndex.length === 0) {
        return { indexed: false };
      }

      const client = getLlamaClient();
      try {
        await client.pipelines.documents.upsert(PIPELINE_ID, {
          body: [
            {
              id: `doc-${documentId}`,
              text: textToIndex,
              metadata: {
                document_id: documentId,
                filename: path.basename(filename) || `document-${documentId}`,
                doc_type: classification.docType,
              },
            },
          ],
        });
        return { indexed: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[store_results] LlamaCloud upsert failed for document ${documentId}:`, msg);
        return { indexed: false };
      }
    }

    return { indexed: false };
  }
);
