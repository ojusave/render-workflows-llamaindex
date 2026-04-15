/**
 * Hono web server: the HTTP layer for the document intelligence pipeline.
 *
 * Endpoints:
 *   POST /upload        - upload a document, returns SSE progress stream
 *   GET  /documents     - list all processed documents
 *   GET  /documents/:id - get a single document with all data
 *   DELETE /documents/:id - delete a document
 *   POST /search        - semantic search across documents
 *   GET  /health        - health check for Render
 *   GET  /              - serve the frontend
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
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

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/upload", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || typeof file === "string") {
    return c.json({ error: "No file provided" }, 400);
  }

  const filename = file.name || "document";
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const tempPath = path.join(UPLOAD_DIR, `${Date.now()}-${filename}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(tempPath, buffer);

  const documentId = await insertDocument(filename);

  return streamSSE(c, async (stream) => {
    try {
      for await (const raw of runPipeline(documentId, tempPath, filename)) {
        const eventMatch = raw.match(/^event: (.+)\ndata: (.+)\n\n$/s);
        if (eventMatch) {
          await stream.writeSSE({ event: eventMatch[1], data: eventMatch[2] });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateDocumentError(documentId, message);
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message, documentId }),
      });
    }
  });
});

app.get("/documents", async (c) => {
  const docs = await listDocuments();
  return c.json(docs);
});

app.get("/documents/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const doc = await getDocument(id);
  if (!doc) return c.json({ error: "Not found" }, 404);
  return c.json(doc);
});

app.delete("/documents/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const deleted = await deleteDocument(id);
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ status: "ok" });
});

app.post("/search", async (c) => {
  const { query } = await c.req.json<{ query: string }>();
  if (!query) return c.json({ error: "Query is required" }, 400);

  const queryEmbedding = placeholderEmbedding(query);
  const results = await searchDocuments(queryEmbedding);
  return c.json(results);
});

app.use("/static/*", serveStatic({ root: "./" }));

app.get("/", serveStatic({ path: "./static/index.html" }));

// Initialize DB and start server
const PORT = parseInt(process.env.PORT || "3000", 10);

initDb()
  .then(() => {
    console.log("Database initialized");
    serve({ fetch: app.fetch, port: PORT }, (info) => {
      console.log(`Server running on http://localhost:${info.port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
