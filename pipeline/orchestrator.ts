/**
 * Pipeline orchestrator: dispatches workflow tasks via the Render SDK,
 * polls for completion, and yields SSE events for real-time progress.
 *
 * Flow:
 *   1. Upload file to LlamaCloud → get file_id
 *   2. classify_document → doc type + confidence
 *   3. parse_document → markdown + text
 *   4. extract_fields → structured JSON
 *   5. store_results → persist to Postgres
 *
 * The web service streams these events to the frontend as SSE.
 */

import { Render } from "@renderinc/sdk";
import LlamaCloud from "@llamaindex/llama-cloud";
import fs from "fs";

const WORKFLOW_SLUG = process.env.WORKFLOW_SLUG || "render-workflows-llamaindex-workflow";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "3000", 10);

const render = new Render();

function sse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function startAndWait(
  taskPath: string,
  params: unknown[]
): Promise<unknown> {
  const started = await render.workflows.startTask(
    `${WORKFLOW_SLUG}/${taskPath}`,
    params
  );

  while (true) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const details = await render.workflows.getTaskRun(started.taskRunId);
    const status = details.status;

    if (status === "completed") {
      return details.results?.[0] ?? null;
    }
    if (status === "failed" || status === "canceled") {
      const error = details.error ?? "unknown error";
      throw new Error(`Task ${taskPath} ${status}: ${error}`);
    }
  }
}

export async function* runPipeline(
  documentId: number,
  filePath: string,
  filename: string
): AsyncGenerator<string> {
  const t0 = Date.now();

  try {
    // Step 0: Upload file to LlamaCloud
    yield sse("status", { phase: "uploading", documentId, filename });

    const client = new LlamaCloud({
      apiKey: process.env.LLAMA_CLOUD_API_KEY!,
    });

    const fileStream = fs.createReadStream(filePath);
    const uploadedFile = await client.files.create({
      file: fileStream,
      purpose: "extract",
    });
    const fileId = uploadedFile.id;

    yield sse("uploaded", { fileId, filename });

    // Step 1: Classify
    yield sse("status", {
      phase: "classifying",
      tools: ["LlamaCloud Classify", "Render Workflows"],
    });

    const classification = (await startAndWait("classify_document", [fileId])) as {
      docType: string;
      confidence: number;
      reasoning: string;
    };

    yield sse("classified", {
      docType: classification.docType,
      confidence: classification.confidence,
      reasoning: classification.reasoning,
    });

    // Step 2: Parse
    yield sse("status", {
      phase: "parsing",
      tools: ["LlamaParse", "Render Workflows"],
    });

    const parsed = (await startAndWait("parse_document", [fileId])) as {
      markdown: string;
      text: string;
      pageCount: number;
      pages: Array<{ pageNumber: number; markdown: string }>;
    };

    yield sse("parsed", {
      pageCount: parsed.pageCount,
      markdownPreview: parsed.markdown.slice(0, 500),
    });

    // Step 3: Extract
    yield sse("status", {
      phase: "extracting",
      tools: ["LlamaExtract", "Render Workflows"],
      docType: classification.docType,
    });

    const extracted = (await startAndWait("extract_fields", [
      fileId,
      classification.docType,
    ])) as {
      extractedData: Record<string, unknown>;
      schemaUsed: Record<string, unknown>;
    };

    yield sse("extracted", {
      fields: Object.keys(extracted.extractedData),
      data: extracted.extractedData,
    });

    // Step 4: Store
    yield sse("status", {
      phase: "storing",
      tools: ["Render Postgres", "pgvector", "Render Workflows"],
    });

    const stored = (await startAndWait("store_results", [
      documentId,
      classification,
      parsed,
      extracted,
    ])) as { chunksStored: number };

    const elapsed = Math.round((Date.now() - t0) / 1000);

    yield sse("done", {
      documentId,
      filename,
      docType: classification.docType,
      confidence: classification.confidence,
      pageCount: parsed.pageCount,
      fieldsExtracted: Object.keys(extracted.extractedData).length,
      chunksStored: stored.chunksStored,
      elapsed,
    });
  } catch (err) {
    const elapsed = Math.round((Date.now() - t0) / 1000);
    const message = err instanceof Error ? err.message : String(err);
    yield sse("error", { message, elapsed, documentId });
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore cleanup errors
    }
  }
}
