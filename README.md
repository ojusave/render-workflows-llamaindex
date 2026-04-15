# Document Intelligence Pipeline

A document processing pipeline that takes any file (PDF, spreadsheet, image, HTML), figures out what it is, and extracts structured data from it. Built on [LlamaCloud](https://cloud.llamaindex.ai) for the document AI, [Render Workflows](https://render.com/docs/workflows) for durable task execution, and [Render Postgres](https://render.com/docs/databases) with [pgvector](https://github.com/pgvector/pgvector) for storage and search.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ojusave/render-workflows-llamaindex)

## Contents

- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Deploy to Render](#deploy-to-render)
- [Configuration](#configuration)
- [Local development](#local-development)
- [Project structure](#project-structure)
- [Extending](#extending)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)

## How it works

Each uploaded document passes through four stages, running as isolated [Render Workflow tasks](https://render.com/docs/workflows-defining) with automatic retries:

1. **Classify** via [LlamaCloud Classify](https://developers.llamaindex.ai/cloud-api-reference/llama-platform/classify): determines the document type with confidence scoring and reasoning
2. **Parse** via [LlamaParse](https://developers.llamaindex.ai/cloud-api-reference/llama-platform/parse) agentic tier: converts 130+ file formats into clean markdown, preserving tables and layout
3. **Extract** via [LlamaExtract](https://developers.llamaindex.ai/cloud-api-reference/llama-platform/extract): pulls structured fields using a JSON Schema matched to the classified type. Unknown types get an auto-generated schema.
4. **Store** in [Render Postgres](https://render.com/docs/databases) with [pgvector](https://render.com/docs/postgresql-extensions#pgvector): persists the parsed content, structured data, and chunk embeddings

The web service dispatches these tasks via the [Render SDK](https://render.com/docs/workflows-sdk-typescript) and streams progress to the browser via SSE. You see each stage complete in real time, then browse extracted data and search across all your documents.

```
Browser ──upload──▶ Web Service ──trigger──▶ Render Workflows
                        │                        │
                        │◀──poll + SSE───────────│
                        │                        ▼
                        │              classify → parse → extract → store
                        │                                              │
                        ▼                                              ▼
                    Serve UI ◀─── query ◀── Render Postgres (pgvector)
```

**Tech stack**: [Hono](https://hono.dev) on Node.js, [@llamaindex/llama-cloud](https://www.npmjs.com/package/@llamaindex/llama-cloud) TypeScript SDK, [@renderinc/sdk](https://www.npmjs.com/package/@renderinc/sdk) for Workflows, [pg](https://www.npmjs.com/package/pg) for Postgres.

## Prerequisites

- A [Render account](https://render.com/register?utm_source=github&utm_medium=referral&utm_campaign=ojus_demos&utm_content=hero_cta) (free tier works for the database; web service needs at least Starter)
- A [LlamaCloud account](https://cloud.llamaindex.ai) and API key (the agentic parsing tier costs credits per page: see [LlamaCloud pricing](https://cloud.llamaindex.ai/pricing))
- A [Render API key](https://render.com/docs/api#1-create-an-api-key) for triggering workflow tasks
- Node.js 20+ (for local development only)

## Deploy to Render

### 1. Web service + database (via Blueprint)

Click the Deploy to Render button above, or create a [Blueprint](https://render.com/docs/infrastructure-as-code) from this repo. The [`render.yaml`](render.yaml) defines:

- A **web service** (`render-workflows-llamaindex`) running the Hono server
- A **Postgres database** (`llamaindex-docs-db`) with automatic connection string injection via [`fromDatabase`](https://render.com/docs/infrastructure-as-code#referencing-values-from-other-components)

You will be prompted for `RENDER_API_KEY` and `LLAMA_CLOUD_API_KEY` during deploy.

### 2. Workflow service (manual)

[Render Workflows](https://render.com/docs/workflows) are not yet supported in Blueprints. Create one manually:

1. Go to [Render Dashboard](https://dashboard.render.com) > New > Workflow
2. Connect this repository
3. Set the build command: `npm install && npm run build`
4. Set the start command: `node dist/tasks/index.js`
5. Name it to match the `WORKFLOW_SLUG` env var (default: `render-workflows-llamaindex-workflow`)
6. Add these environment variables:
   - `LLAMA_CLOUD_API_KEY`: your LlamaCloud API key
   - `DATABASE_URL`: the **Internal URL** from your [Render Postgres instance](https://render.com/docs/databases#connecting-from-within-render)

## Configuration

| Variable | Required on | Default | Description |
|---|---|---|---|
| `RENDER_API_KEY` | Web service | (required) | [Render API key](https://render.com/docs/api#1-create-an-api-key) for triggering workflow tasks |
| `LLAMA_CLOUD_API_KEY` | Both | (required) | [LlamaCloud API key](https://cloud.llamaindex.ai) for document processing |
| `DATABASE_URL` | Both | (required) | Postgres connection string. Auto-injected on the web service via Blueprint. Use the [Internal URL](https://render.com/docs/databases#connecting-from-within-render) for same-region services. |
| `WORKFLOW_SLUG` | Web service | `render-workflows-llamaindex-workflow` | Must match the workflow service name in the [Dashboard](https://dashboard.render.com) |
| `POLL_INTERVAL_MS` | Web service | `3000` | How often the orchestrator polls task status (ms) |
| `CHUNK_SIZE` | Workflow | `1000` | Text chunk size in characters for embedding |
| `CHUNK_OVERLAP` | Workflow | `200` | Overlap between chunks in characters |
| `PORT` | Web service | `3000` | Server port. [Render sets this automatically](https://render.com/docs/environment-variables#all-runtimes). |

## Local development

```bash
git clone https://github.com/ojusave/render-workflows-llamaindex.git
cd render-workflows-llamaindex
npm install
cp .env.example .env
# Fill in RENDER_API_KEY, LLAMA_CLOUD_API_KEY, DATABASE_URL in .env
npm run dev
```

The workflow tasks run in a separate process:

```bash
npm run dev:tasks
```

Local dev requires a running Postgres with pgvector and a deployed workflow service on Render (the web service triggers tasks remotely). For a fully local setup, you can point `DATABASE_URL` at a local Postgres with `CREATE EXTENSION vector` enabled.

## Project structure

```
main.ts                      Hono web server: upload, documents, search, health
pipeline/
  orchestrator.ts            Dispatch workflow tasks, poll, stream SSE
tasks/
  index.ts                   Workflow entry point: registers all tasks
  classify.ts                classify_document: LlamaCloud Classify API
  parse.ts                   parse_document: LlamaParse agentic tier
  extract.ts                 extract_fields: LlamaExtract with auto-schema
  schemas.ts                 JSON Schemas per document type
  store.ts                   store_results: Postgres + pgvector embeddings
  llama-client.ts            Shared LlamaCloud client singleton
shared/
  db.ts                      Postgres pool, schema init, all queries
  embedding.ts               Placeholder embedding (swap for production)
static/
  index.html                 Frontend: upload, progress feed, doc browser, search
render.yaml                  Render Blueprint: web service + Postgres
```

## Extending

**Add a new document type**: add a rule to `CLASSIFICATION_RULES` in [`tasks/classify.ts`](tasks/classify.ts) and a matching JSON Schema entry in [`tasks/schemas.ts`](tasks/schemas.ts). The extract task picks the schema automatically based on the classified type.

**Swap the placeholder embedding**: the file [`shared/embedding.ts`](shared/embedding.ts) generates a deterministic hash vector for demo purposes. Replace `placeholderEmbedding()` with a call to an actual embedding API (OpenAI, Cohere, etc.) for meaningful semantic search results.

**Supported formats**: LlamaParse handles 130+ input formats including PDF, DOCX, XLSX, PPTX, HTML, images (with OCR in 80+ languages), and more. See the [LlamaParse docs](https://developers.llamaindex.ai/cloud-api-reference/llama-platform/parse) for the full list.

## Operations

**Health check**: `GET /health` returns `{"status":"ok"}`. This is configured as the [`healthCheckPath`](render.yaml) in the Blueprint.

**Logs**: view web service and workflow task logs in the [Render Dashboard](https://dashboard.render.com) under each service's Logs tab. Workflow task runs also appear under the Workflows section with per-run status and output.

**Database**: the web service creates tables and indexes on startup via [`shared/db.ts`](shared/db.ts). Two tables: `documents` (metadata, parsed content, structured data) and `document_chunks` (text chunks with pgvector embeddings and an HNSW index).

**Costs**: LlamaCloud charges credits per page for the agentic parsing and extraction tiers. See [LlamaCloud pricing](https://cloud.llamaindex.ai/pricing). Render Workflow tasks bill per-second at the configured plan tier (default: `starter` for classify, `standard` for parse/extract/store). See [Render pricing](https://render.com/pricing).

## Troubleshooting

**Workflow tasks fail immediately**: check that `WORKFLOW_SLUG` on the web service matches the actual workflow service name in the [Render Dashboard](https://dashboard.render.com). The slug format is the service name in lowercase with hyphens.

**Database connection errors**: verify `DATABASE_URL` uses the [Internal URL](https://render.com/docs/databases#connecting-from-within-render) (not External) for same-region private networking. The pgvector extension is created automatically on first startup.

**LlamaCloud rate limits**: the pipeline uses the agentic parsing tier, which has rate limits. If you hit 429 errors, the tasks retry automatically (up to 2 retries with exponential backoff). Check your [LlamaCloud usage dashboard](https://cloud.llamaindex.ai) for quota status.

**Search returns poor results**: the default [`shared/embedding.ts`](shared/embedding.ts) uses a placeholder hash, not real embeddings. Semantic search will not be meaningful until you swap it for an actual embedding API.
