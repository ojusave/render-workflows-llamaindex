/**
 * Workflow task: materialize uploaded bytes to a temp file with the correct
 * extension and register the file with LlamaCloud. Runs on the workflow
 * service so the web tier only reads the upload and dispatches tasks.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { task } from "@renderinc/sdk/workflows";
import { getLlamaClient } from "../shared/llama-client.js";

export const uploadToLlamaCloud = task(
  {
    name: "upload_to_llamacloud",
    plan: "starter",
    timeoutSeconds: 120,
    retry: { maxRetries: 2, waitDurationMs: 3000, backoffScaling: 2 },
  },
  async function uploadToLlamaCloud(
    fileBase64: string,
    filename: string
  ): Promise<{ fileId: string }> {
    const buf = Buffer.from(fileBase64, "base64");
    if (buf.length === 0) {
      throw new Error("Empty file");
    }

    const ext = path.extname(filename);
    const stem = path.basename(filename, ext).replace(/[^a-zA-Z0-9._-]/g, "_") || "document";
    const tmpPath = path.join(os.tmpdir(), `lc-${Date.now()}-${stem}${ext || ".bin"}`);

    fs.writeFileSync(tmpPath, buf);
    try {
      const client = getLlamaClient();
      const stream = fs.createReadStream(tmpPath);
      const uploaded = await client.files.create({
        file: stream,
        purpose: "parse",
      });
      return { fileId: uploaded.id };
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }
);
