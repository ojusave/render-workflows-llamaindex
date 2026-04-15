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

/**
 * LlamaCloud infers file type from the path extension. Names like "download" or
 * ".bin" yield "Unsupported file type: None". Prefer real extensions; sniff bytes when missing.
 */
function inferExtension(filename: string, buf: Buffer): string {
  const fromName = path.extname(filename).toLowerCase();
  if (fromName && fromName !== ".bin") {
    return fromName;
  }

  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return ".pdf";
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") {
    return ".pdf";
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) {
    return ".jpg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return ".png";
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return ".docx";
  }

  const sample = buf.subarray(0, Math.min(buf.length, 2048));
  let printable = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === undefined) continue;
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) {
      printable++;
    }
  }
  if (sample.length > 20 && printable / sample.length > 0.97) {
    return ".txt";
  }

  return ".pdf";
}

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

    const extFromName = path.extname(filename);
    const stem = path.basename(filename, extFromName).replace(/[^a-zA-Z0-9._-]/g, "_") || "document";
    const ext = inferExtension(filename, buf);
    const tmpPath = path.join(os.tmpdir(), `lc-${Date.now()}-${stem}${ext}`);

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
