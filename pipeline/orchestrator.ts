/**
 * Pipeline orchestrator: dispatches workflow tasks via the Render SDK,
 * polls for completion, and yields SSE events for real-time progress.
 *
 * Flow (all LlamaCloud work runs on the workflow service except reading the
 * temp upload on this host to send bytes to the first task):
 *   1. upload_to_llamacloud → LlamaCloud file_id
 *   2. classify_document → doc type + confidence
 *   3. parse_document → markdown + text
 *   4. extract_fields → structured JSON
 *   5. store_results → persist to Postgres + index in LlamaCloud pipeline
 *
 * The web service streams these events to the frontend as SSE.
 */

import { Render } from "@renderinc/sdk";
import fs from "fs";

const WORKFLOW_SLUG = process.env.WORKFLOW_SLUG || "render-workflows-llamaindex-workflow";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "3000", 10);
const MAX_UPLOAD_BYTES = parseInt(
  process.env.MAX_UPLOAD_BYTES || String(100 * 1024 * 1024),
  10
);

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
    const buf = fs.readFileSync(filePath);
    if (buf.length > MAX_UPLOAD_BYTES) {
      throw new Error(
        `File too large (max ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB; set MAX_UPLOAD_BYTES if needed)`
      );
    }
    const fileBase64 = buf.toString("base64");

    // Step 0: Workflow task uploads bytes to LlamaCloud (web only read FS + dispatch)
    yield sse("status", { phase: "uploading", documentId, filename });

    const uploadResult = (await startAndWait("upload_to_llamacloud", [
      fileBase64,
      filename,
    ])) as { fileId: string };
    const fileId = uploadResult.fileId;

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

    // Step 4: Store + index in LlamaCloud pipeline
    yield sse("status", {
      phase: "storing",
      tools: ["Render Postgres", "LlamaCloud Index", "Render Workflows"],
    });

    const stored = (await startAndWait("store_results", [
      documentId,
      fileId,
      classification,
      parsed,
      extracted,
      filename,
    ])) as { indexed: boolean };

    const elapsed = Math.round((Date.now() - t0) / 1000);

    yield sse("done", {
      documentId,
      filename,
      docType: classification.docType,
      confidence: classification.confidence,
      pageCount: parsed.pageCount,
      fieldsExtracted: Object.keys(extracted.extractedData).length,
      indexed: stored.indexed,
      elapsed,
    });
  } catch (err) {
    const elapsed = Math.round((Date.now() - t0) / 1000);
    const message = err instanceof Error ? err.message : String(err);
    const { updateDocumentError } = await import("../shared/db.js");
    await updateDocumentError(documentId, message);
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
