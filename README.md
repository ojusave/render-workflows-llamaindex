# Document Intelligence Pipeline

Upload any document. The pipeline classifies it, parses it to clean markdown, extracts structured fields, and indexes it for semantic search and RAG: powered by [LlamaCloud](https://cloud.llamaindex.ai) and orchestrated by [Render Workflows](https://render.com/docs/workflows).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ojusave/render-workflows-llamaindex)

## How it works

![Architecture diagram](static/images/architecture-diagram.png)

The web service accepts file uploads (or URLs) and dispatches four [Render Workflow tasks](https://render.com/docs/workflows-defining), each with its own compute, retries, and timeout. Progress streams back to the browser via SSE as each stage completes. Processed documents are indexed in a [LlamaCloud managed pipeline](https://developers.llamaindex.ai/cloud-api-reference/llama-platform/) for semantic search with real embeddings, hybrid retrieval, and reranking.

![Pipeline flow](static/images/pipeline-flow.png)

After processing, you can ask questions across all your documents. The "Ask" feature retrieves relevant passages from the LlamaCloud index and returns them with source citations.

## Prerequisites

- A [Render account](https://render.com/register?utm_source=github&utm_medium=referral&utm_campaign=ojus_demos&utm_content=hero_cta) (free tier works for the database; web service needs at least Starter)
- A [LlamaCloud account](https://cloud.llamaindex.ai) and API key ([pricing](https://cloud.llamaindex.ai/pricing): agentic tier costs credits per page)
- A [Render API key](https://render.com/docs/api#1-create-an-api-key)
- Optional: a [LlamaCloud pipeline](https://cloud.llamaindex.ai) for semantic search (Index > Create Pipeline in the LlamaCloud UI)

## Deploy to Render

### 1. Web service + database (via Blueprint)

Click the button above or create a [Blueprint](https://render.com/docs/infrastructure-as-code) from this repo. The [`render.yaml`](render.yaml) creates a web service and a Postgres database with automatic connection string injection.

You will be prompted for `RENDER_API_KEY` and `LLAMA_CLOUD_API_KEY`.

### 2. Workflow service (manual)

1. [Render Dashboard](https://dashboard.render.com) > New > Workflow
2. Connect this repository
3. Build: `npm install && npm run build`
4. Start: `node dist/tasks/index.js`
5. Name: `render-workflows-llamaindex-workflow` (must match `WORKFLOW_SLUG`)
6. Env vars: `LLAMA_CLOUD_API_KEY`, `LLAMACLOUD_PIPELINE_ID`, `DATABASE_URL` ([Internal URL](https://render.com/docs/databases#connecting-from-within-render))

### 3. Enable search (optional)

Create a pipeline in the [LlamaCloud UI](https://cloud.llamaindex.ai) (Index > Create Pipeline). Copy the pipeline ID and set `LLAMACLOUD_PIPELINE_ID` on both the web service and workflow service. Uploaded documents will be automatically indexed, and the "Ask" and "Search" features will use LlamaCloud's managed retrieval with real embeddings and reranking.

## Configuration

| Variable | Where | Default | Description |
|---|---|---|---|
| `RENDER_API_KEY` | Web service | (required) | [Render API key](https://render.com/docs/api#1-create-an-api-key) for dispatching workflow tasks |
| `LLAMA_CLOUD_API_KEY` | Both | (required) | [LlamaCloud API key](https://cloud.llamaindex.ai) |
| `DATABASE_URL` | Both | (required) | Postgres [Internal URL](https://render.com/docs/databases#connecting-from-within-render). Auto-injected on web service via Blueprint. |
| `LLAMACLOUD_PIPELINE_ID` | Both | (optional) | [LlamaCloud pipeline](https://cloud.llamaindex.ai) ID for semantic search and RAG |
| `WORKFLOW_SLUG` | Web service | `render-workflows-llamaindex-workflow` | Must match the workflow service name |
| `PORT` | Web service | `3000` | [Set automatically by Render](https://render.com/docs/environment-variables#all-runtimes) |

## Local development

```bash
git clone https://github.com/ojusave/render-workflows-llamaindex.git
cd render-workflows-llamaindex
npm install
cp .env.example .env   # fill in API keys and DATABASE_URL
npm run dev             # web service
npm run dev:tasks       # workflow tasks (separate terminal)
```

## Project structure

```
main.ts                      Express web server: upload, search, ask, documents
pipeline/orchestrator.ts     Dispatch tasks, poll, stream SSE
tasks/
  index.ts                   Workflow entry point
  classify.ts                LlamaCloud Classify API
  parse.ts                   LlamaParse agentic tier
  extract.ts                 LlamaExtract with auto-schema
  schemas.ts                 JSON Schemas per document type
  store.ts                   Postgres writes + LlamaCloud pipeline indexing
shared/
  db.ts                      Postgres pool, schema init, queries
  llama-client.ts            Shared LlamaCloud client singleton
static/index.html            Frontend UI
render.yaml                  Render Blueprint
```

## Extending

**Add a document type**: add a rule to [`tasks/classify.ts`](tasks/classify.ts) and a matching schema to [`tasks/schemas.ts`](tasks/schemas.ts). The extract task picks the schema automatically.

## Operations

**Health check**: `GET /health` returns `{"status":"ok"}`.

**Logs**: web service and workflow task logs in the [Render Dashboard](https://dashboard.render.com).

## Troubleshooting

**Workflow tasks fail immediately**: `WORKFLOW_SLUG` on the web service must match the workflow service name exactly.

**Database connection errors**: use the [Internal URL](https://render.com/docs/databases#connecting-from-within-render), not the External URL.

**Search returns "not configured"**: set `LLAMACLOUD_PIPELINE_ID` on both web service and workflow service.

**LlamaCloud rate limits**: tasks retry automatically (2 retries with exponential backoff). Check your [usage dashboard](https://cloud.llamaindex.ai).
