# Contributing

Thanks for helping improve this demo.

## Issues

Open an issue for bugs, unclear docs, or small feature ideas. Include what you expected, what happened, and your Render service names or logs when it helps (redact secrets).

## Pull requests

1. Fork the repository and create a focused branch.
2. Match existing TypeScript style and file layout (`main.ts`, `pipeline/`, `tasks/`, `shared/`).
3. Run `npm install` and `npm run build` before pushing. Fix any new TypeScript errors.
4. Describe the change in the PR: what it does and why.

## Adding a document type

To support a new document category end to end:

1. Add a classification rule in [`tasks/classify.ts`](tasks/classify.ts) so the classifier can label uploads of that type.
2. Add a matching JSON Schema in [`tasks/schemas.ts`](tasks/schemas.ts). The extract task selects the schema from the classification result.

You do not need to change the extract task wiring for a new type if the schema is keyed correctly: extract picks the schema automatically from the classified type.

## Validating behavior

End-to-end behavior needs Render plus LlamaCloud API keys. If you cannot run a full deploy, say so in the PR and explain what you verified locally (for example: `npm run build` only, or a partial manual test).

## Security

Do not commit API keys, `.env` files, or internal Render URLs. Use environment variables only.
