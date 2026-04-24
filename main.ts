/**
 * Express web server for the document intelligence pipeline.
 * SSE streaming uses native res.write() which flushes immediately.
 *
 * Ephemeral sessions: Each visitor gets a unique URL (/s/{token}) with isolated
 * data that auto-expires after SESSION_LIFETIME_MINUTES (default 15).
 */

import express, { Request, Response, NextFunction } from "express";
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
  createSession,
  getSessionByToken,
  purgeExpiredSessions,
  purgeOrphanedDocuments,
  extendSession,
  SESSION_LIFETIME_MINUTES,
  type Session,
} from "./shared/db.js";

/** Minimum session time (in minutes) to ensure pipeline can complete. */
const MIN_SESSION_TIME_FOR_UPLOAD = 10;
import { retrieveFromConfiguredPipeline } from "./shared/pipeline-retrieval.js";
import { streamPipeline } from "./pipeline-stream.js";
import { filenameWithExtFromContentType } from "./shared/filename-ext.js";
import { resolveMaxUploadBytes } from "./shared/workflow-limits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, ".uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PIPELINE_ID = process.env.LLAMACLOUD_PIPELINE_ID;

/** Capped at 3 MiB by default: workflow task args (base64 file) must stay under Render's ~4MB limit. */
const MAX_UPLOAD_BYTES = resolveMaxUploadBytes();
const UPLOAD_URL_FETCH_TIMEOUT_MS = parseInt(
  process.env.UPLOAD_URL_FETCH_TIMEOUT_MS || "120000",
  10
);

/** How often to run session purge (ms). Default 60s. */
const SESSION_PURGE_INTERVAL_MS = parseInt(
  process.env.SESSION_PURGE_INTERVAL_MS || "60000",
  10
);

/** Extend Express Request to include session */
declare global {
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: MAX_UPLOAD_BYTES } });
const app = express();

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// Health check (no session required)
// ─────────────────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session management
// ─────────────────────────────────────────────────────────────────────────────

/** Root: create a new session and redirect to /s/{token} */
app.get("/", async (_req, res) => {
  const session = await createSession();
  res.redirect(`/s/${session.token}`);
});

/** Session middleware: validates token and attaches session to request */
async function requireSession(req: Request, res: Response, next: NextFunction) {
  const token = req.params.token;
  if (!token || Array.isArray(token)) {
    res.redirect("/");
    return;
  }
  const session = await getSessionByToken(token);
  if (!session) {
    res.redirect("/");
    return;
  }
  req.session = session;
  next();
}

/** Serve the app at /s/{token} */
app.get("/s/:token", requireSession, (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "static", "index.html"));
});

/** Get session info (for frontend to show expiry countdown) */
app.get("/s/:token/session", requireSession, (req, res) => {
  const session = req.session!;
  res.json({
    token: session.token,
    created_at: session.created_at,
    expires_at: session.expires_at,
    lifetime_minutes: SESSION_LIFETIME_MINUTES,
    max_upload_bytes: MAX_UPLOAD_BYTES,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session-scoped API routes
// ─────────────────────────────────────────────────────────────────────────────

app.post("/s/:token/upload", requireSession, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }
  // Extend session to ensure pipeline has time to complete
  await extendSession(req.session!.id, MIN_SESSION_TIME_FOR_UPLOAD);
  const filename = file.originalname || "document";
  const documentId = await insertDocument(req.session!.id, filename);
  await streamPipeline(res, documentId, file.path, filename);
});

app.post("/s/:token/upload-url", requireSession, async (req, res) => {
  const { url } = req.body;
  if (!url) {
    res.status(400).json({ error: "No URL provided" });
    return;
  }

  const parsedUrl = new URL(url);
  let filename = path.basename(parsedUrl.pathname) || "download";
  const tempPath = path.join(UPLOAD_DIR, `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_URL_FETCH_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
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

  // Extend session to ensure pipeline has time to complete
  await extendSession(req.session!.id, MIN_SESSION_TIME_FOR_UPLOAD);
  const documentId = await insertDocument(req.session!.id, filename);
  await streamPipeline(res, documentId, tempPath, filename);
});

app.get("/s/:token/documents", requireSession, async (req, res) => {
  const docs = await listDocuments(req.session!.id);
  res.json(docs);
});

app.get("/s/:token/documents/:id", requireSession, async (req, res) => {
  const rawId = req.params.id;
  const id = parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  const doc = await getDocument(req.session!.id, id);
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(doc);
});

app.delete("/s/:token/documents/:id", requireSession, async (req, res) => {
  const rawId = req.params.id;
  const id = parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  const deleted = await deleteDocument(req.session!.id, id);
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ status: "ok" });
});

app.post("/s/:token/search", requireSession, async (req, res) => {
  const { query } = req.body;
  if (!query) {
    res.status(400).json({ error: "Query is required" });
    return;
  }
  if (!PIPELINE_ID) {
    res.status(503).json({ error: "Search not configured: set LLAMACLOUD_PIPELINE_ID" });
    return;
  }

  try {
    const results = await retrieveFromConfiguredPipeline(PIPELINE_ID!, query, 10, 5);
    res.json(results);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/s/:token/ask", requireSession, async (req, res) => {
  const { question } = req.body;
  if (!question) {
    res.status(400).json({ error: "Question is required" });
    return;
  }
  if (!PIPELINE_ID) {
    res.status(503).json({ error: "RAG not configured: set LLAMACLOUD_PIPELINE_ID" });
    return;
  }

  try {
    const sources = await retrieveFromConfiguredPipeline(PIPELINE_ID!, question, 8, 4);
    const context = sources.map((s, i) => `[${i + 1}] ${s.text}`).join("\n\n");

    res.json({
      question,
      context,
      sources: sources.map((s) => ({ ...s, text: s.text.slice(0, 200) })),
      answer:
        sources.length > 0
          ? `Based on ${sources.length} relevant passages from your documents:\n\n${context}`
          : "No relevant documents found. Upload some documents first.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Static assets (shared across sessions)
app.use(express.static(path.join(__dirname, "static"), { maxAge: 0, etag: false }));

const PORT = parseInt(process.env.PORT || "3000", 10);

initDb()
  .then(() => {
    console.log("Database initialized");

    // Session purge: delete expired sessions (CASCADE deletes their documents)
    const runPurge = async () => {
      try {
        const sessionsRemoved = await purgeExpiredSessions();
        if (sessionsRemoved > 0) {
          console.log(`Session cleanup: removed ${sessionsRemoved} expired session(s) and their documents`);
        }
        const orphansRemoved = await purgeOrphanedDocuments();
        if (orphansRemoved > 0) {
          console.log(`Session cleanup: removed ${orphansRemoved} orphaned document(s)`);
        }
      } catch (err) {
        console.error("Session purge failed:", err);
      }
    };
    runPurge();
    setInterval(runPurge, SESSION_PURGE_INTERVAL_MS);
    console.log(
      `Ephemeral sessions: ${SESSION_LIFETIME_MINUTES} min lifetime, purge every ${SESSION_PURGE_INTERVAL_MS}ms`
    );

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
