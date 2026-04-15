/**
 * Workflow service entry point: registers all tasks with the Render Workflows runtime.
 *
 * Deploy this as a Render Workflow service with:
 *   build: npm install && npm run build
 *   start: node dist/tasks/index.js
 *
 * Four tasks run the document intelligence pipeline:
 *   - classify_document: LlamaCloud Classify API
 *   - parse_document: LlamaParse agentic tier
 *   - extract_fields: LlamaExtract with auto-schema
 *   - store_results: persist to Postgres + generate embeddings
 */

import "./classify.js";
import "./parse.js";
import "./extract.js";
import "./store.js";
