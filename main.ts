/**
 * Express web server for the document intelligence pipeline.
 * SSE streaming uses native res.write() which flushes immediately.
 * File uploads handled by multer. Search and RAG via LlamaCloud pipelines.
 */

import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  initDb,
  insertDocument,
  listDocuments,
  getDocument,
  deleteDocument,
  updateDocumentError,
} from "./shared/db.js";
import { retrieveFromConfiguredPipeline } from "./shared/pipeline-retrieval.js";
import { runPipeline } from "./pipeline/orchestrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, ".uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PIPELINE_ID = process.env.LLAMACLOUD_PIPELINE_ID;

/** Default 100 MB: large PDFs (e.g. full Bibles) exceed smaller demo caps. Override with MAX_UPLOAD_BYTES. */
const MAX_UPLOAD_BYTES = parseInt(
  process.env.MAX_UPLOAD_BYTES || String(100 * 1024 * 1024),
  10
);
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: MAX_UPLOAD_BYTES } });
const app = express();

app.use(cors());
app.use(express.json());

function sseHeaders(res: express.Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(":ok\n\n");
}

/** URL paths often lack an extension; LlamaCloud needs one for file type detection. */
function filenameWithExtFromContentType(
  basename: string,
  contentType: string | null | undefined
): string {
  if (path.extname(basename)) return basename;
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("pdf")) return `${basename}.pdf`;
  if (ct.includes("html")) return `${basename}.html`;
  if (ct.includes("markdown")) return `${basename}.md`;
  if (ct.includes("wordprocessingml") || ct.includes("msword")) return `${basename}.docx`;
  if (ct.includes("spreadsheetml") || ct.includes("excel")) return `${basename}.xlsx`;
  if (ct.includes("png")) return `${basename}.png`;
  if (ct.includes("jpeg") || ct.includes("jpg")) return `${basename}.jpg`;
  if (ct.startsWith("text/")) return `${basename}.txt`;
  return `${basename}.pdf`;
}

async function streamPipeline(
  res: express.Response,
  documentId: number,
  tempPath: string,
  filename: string
) {
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

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: "No file provided" }); return; }
  const filename = file.originalname || "document";
  const documentId = await insertDocument(filename);
  await streamPipeline(res, documentId, file.path, filename);
});

app.post("/upload-url", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "No URL provided" }); return; }

  const parsedUrl = new URL(url);
  let filename = path.basename(parsedUrl.pathname) || "download";
  const tempPath = path.join(UPLOAD_DIR, `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      res.status(400).json({ error: `Failed to download: HTTP ${response.status}` });
      return;
    }
    filename = filenameWithExtFromContentType(filename, response.headers.get("content-type"));
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_UPLOAD_BYTES) {
      res.status(400).json({
        error: `Downloaded file too large (max ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB)`,
      });
      return;
    }
    fs.writeFileSync(tempPath, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `Failed to download: ${message}` });
    return;
  }

  const documentId = await insertDocument(filename);
  await streamPipeline(res, documentId, tempPath, filename);
});

app.get("/documents", async (_req, res) => {
  const docs = await listDocuments();
  res.json(docs);
});

app.get("/documents/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const doc = await getDocument(id);
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  res.json(doc);
});

app.delete("/documents/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const deleted = await deleteDocument(id);
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ status: "ok" });
});

app.post("/search", async (req, res) => {
  const { query } = req.body;
  if (!query) { res.status(400).json({ error: "Query is required" }); return; }
  if (!PIPELINE_ID) { res.status(503).json({ error: "Search not configured: set LLAMACLOUD_PIPELINE_ID" }); return; }

  try {
    const results = await retrieveFromConfiguredPipeline(PIPELINE_ID!, query, 10, 5);
    res.json(results);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/ask", async (req, res) => {
  const { question } = req.body;
  if (!question) { res.status(400).json({ error: "Question is required" }); return; }
  if (!PIPELINE_ID) { res.status(503).json({ error: "RAG not configured: set LLAMACLOUD_PIPELINE_ID" }); return; }

  try {
    const sources = await retrieveFromConfiguredPipeline(PIPELINE_ID!, question, 8, 4);
    const context = sources.map((s, i) => `[${i + 1}] ${s.text}`).join("\n\n");

    res.json({
      question,
      context,
      sources: sources.map((s) => ({ ...s, text: s.text.slice(0, 200) })),
      answer: sources.length > 0
        ? `Based on ${sources.length} relevant passages from your documents:\n\n${context}`
        : "No relevant documents found. Upload some documents first.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.use(express.static(path.join(__dirname, "static"), { maxAge: 0, etag: false }));

app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "static", "index.html"));
});

const PORT = parseInt(process.env.PORT || "3000", 10);

initDb()
  .then(() => {
    console.log("Database initialized");
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
