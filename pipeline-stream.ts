/**
 * SSE helpers and document pipeline streaming for the Express server.
 */

import type { Response } from "express";
import { runPipeline } from "./pipeline/orchestrator.js";
import { updateDocumentError } from "./shared/db.js";

function sseHeaders(res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(":ok\n\n");
}

export async function streamPipeline(
  res: Response,
  documentId: number,
  tempPath: string,
  filename: string
): Promise<void> {
  sseHeaders(res);
  try {
    for await (const event of runPipeline(documentId, tempPath, filename)) {
      res.write(event);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateDocumentError(documentId, message);
    res.write(`event: error\ndata: ${JSON.stringify({ message, documentId })}\n\n`);
  }
  res.end();
}
