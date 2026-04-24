/**
 * Workflow task: materialize uploaded bytes to a temp file with the correct
 * extension and register the file with LlamaCloud. Runs on the workflow
 * service so the web tier only reads the upload and dispatches tasks.
 *
 * The web service passes the file as base64 in task arguments; keep raw size
 * within shared/workflow-limits.ts (3 MiB default) to satisfy Render’s ~4MB
 * per-invocation argument limit.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { task } from "@renderinc/sdk/workflows";
import { getLlamaClient } from "../shared/llama-client.js";
import { fileTypeFromBuffer } from "file-type";

const SupportedExtensions = [
  ".pdf",
  ".abw",
  ".awt",
  ".cgm",
  ".cwk",
  ".doc",
  ".docm",
  ".docx",
  ".dot",
  ".dotm",
  ".dotx",
  ".fodg",
  ".fodp",
  ".fopd",
  ".fodt",
  ".fb2",
  ".hwp",
  ".lwp",
  ".mcw",
  ".mw",
  ".mwd",
  ".odf",
  ".odt",
  ".otg",
  ".ott",
  ".pages",
  ".pbd",
  ".psw",
  ".rtf",
  ".sda",
  ".sdd",
  ".sdp",
  ".sdw",
  ".sgl",
  ".std",
  ".stw",
  ".sxd",
  ".sxg",
  ".sxm",
  ".sxw",
  ".uof",
  ".uop",
  ".uot",
  ".vor",
  ".wpd",
  ".wps",
  ".wpt",
  ".wri",
  ".wn",
  ".xml",
  ".zabw",
  ".key",
  ".odp",
  ".odg",
  ".otp",
  ".pot",
  ".potm",
  ".potx",
  ".ppt",
  ".pptm",
  ".pptx",
  ".sti",
  ".sxi",
  ".vsd",
  ".vsdm",
  ".vsdx",
  ".vdx",
  ".bmp",
  ".gif",
  ".jpg",
  ".jpeg",
  ".png",
  ".svg",
  ".tif",
  ".tiff",
  ".webp",
  ".htm",
  ".html",
  ".xhtm",
  ".csv",
  ".dbf",
  ".dif",
  ".et",
  ".eth",
  ".fods",
  ".numbers",
  ".ods",
  ".ots",
  ".prn",
  ".qpw",
  ".slk",
  ".stc",
  ".sxc",
  ".sylk",
  ".tsv",
  ".uos1",
  ".uos2",
  ".uos",
  ".wb1",
  ".wb2",
  ".wb3",
  ".wk1",
  ".wk2",
  ".wk3",
  ".wk4",
  ".wks",
  ".wq1",
];

/**
 * LlamaCloud infers file type from the path extension. Names like "download" or
 * ".bin" yield "Unsupported file type: None". Prefer real extensions; infer extension when one is missing.
 */
async function inferExtension(filename: string, buf: Buffer): Promise<string> {
  const fromName = path.extname(filename).toLowerCase();
  if (fromName) {
    if (!SupportedExtensions.includes(fromName)) {
      throw new Error(`Unsupported file type: '${fromName}'`);
    }
    return fromName;
  }

  const ft = await fileTypeFromBuffer(buf);
  if (ft && ft.ext) {
    if (!SupportedExtensions.includes("." + ft.ext)) {
      throw new Error(`Unsupported file type: '.${ft.ext}'`);
    }
    return "." + ft.ext;
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
    filename: string,
  ): Promise<{ fileId: string }> {
    const buf = Buffer.from(fileBase64, "base64");
    if (buf.length === 0) {
      throw new Error("Empty file");
    }

    const extFromName = path.extname(filename);
    const stem =
      path.basename(filename, extFromName).replace(/[^a-zA-Z0-9._-]/g, "_") ||
      "document";
    const ext = await inferExtension(filename, buf);
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
  },
);
