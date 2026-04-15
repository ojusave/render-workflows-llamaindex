/**
 * Express web server for the document intelligence pipeline.
 * SSE streaming uses native res.write() which flushes immediately.
 * File uploads handled by multer, stored in .uploads/ during processing.
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
  searchDocuments,
} from "./shared/db.js";
import { placeholderEmbedding } from "./shared/embedding.js";
import { runPipeline } from "./pipeline/orchestrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, ".uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });
const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  const filename = file.originalname || "document";
  const tempPath = file.path;

  const documentId = await insertDocument(filename);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

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

  const queryEmbedding = placeholderEmbedding(query);
  const results = await searchDocuments(queryEmbedding);
  res.json(results);
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
