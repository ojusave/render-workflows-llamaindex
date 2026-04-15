/**
 * Workflow service entry point: registers all tasks with the Render Workflows runtime.
 *
 * Deploy this as a Render Workflow service with:
 *   build: npm install && npm run build
 *   start: node dist/tasks/index.js
 *
 * Five tasks run the document intelligence pipeline:
 *   - upload_to_llamacloud: register bytes with LlamaCloud Files API
 *   - classify_document: LlamaCloud Classify API
 *   - parse_document: LlamaParse agentic tier
 *   - extract_fields: LlamaExtract with auto-schema
 *   - store_results: persist to Postgres + index in LlamaCloud pipeline
 */

import { initDb } from "../shared/db.js";

await initDb();

await import("./upload.js");
await import("./classify.js");
await import("./parse.js");
await import("./extract.js");
await import("./store.js");
