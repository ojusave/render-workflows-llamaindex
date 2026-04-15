/**
 * Workflow task: extract structured fields from a document using LlamaExtract.
 * Picks a predefined JSON Schema for known doc types (invoice, contract, etc.)
 * or asks LlamaCloud to generate one for unknown types.
 */

import { task } from "@renderinc/sdk/workflows";
import { getLlamaClient } from "./llama-client.js";
import { SCHEMAS, type DataSchema } from "./schemas.js";
export const extractFields = task(
  {
    name: "extract_fields",
    plan: "standard",
    timeoutSeconds: 300,
    retry: { maxRetries: 2, waitDurationMs: 5000, backoffScaling: 2 },
  },
  async function extractFields(
    fileId: string,
    docType: string
  ): Promise<{
    extractedData: Record<string, unknown>;
    schemaUsed: Record<string, unknown>;
  }> {
    const client = getLlamaClient();

    let schema: DataSchema;
    if (SCHEMAS[docType]) {
      schema = SCHEMAS[docType];
    } else {
      const generated = await client.extract.generateSchema({
        prompt: `Extract all key fields and structured information from this ${docType} document. Include dates, names, identifiers, amounts, and any important data points.`,
      });
      const params = generated.parameters;
      if ("data_schema" in params) {
        schema = params.data_schema as DataSchema;
      } else {
        schema = {
          type: "object",
          properties: {
            summary: { type: "string", description: "Brief summary of the document content" },
            key_fields: { type: "array", items: { type: "string" }, description: "Important data points found" },
          } as Record<string, unknown>,
        };
      }
    }

    const job = await client.extract.create({
      file_input: fileId,
      configuration: {
        data_schema: schema,
        cite_sources: true,
        confidence_scores: true,
      },
    });

    const poll = async () => {
      while (true) {
        const status = await client.extract.get(job.id);
        if (status.status === "COMPLETED") return status;
        if (status.status === "FAILED") throw new Error(status.error_message ?? "Extract failed");
        await new Promise((r) => setTimeout(r, 2000));
      }
    };

    const result = await poll();

    const extractResult = result.extract_result;
    const extractedData: Record<string, unknown> =
      extractResult && !Array.isArray(extractResult) ? extractResult : {};

    return {
      extractedData,
      schemaUsed: schema,
    };
  }
);
