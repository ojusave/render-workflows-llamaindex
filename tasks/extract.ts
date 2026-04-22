/**
 * Workflow task: extract structured fields from a document using LlamaExtract.
 * Picks a predefined JSON Schema for known doc types (invoice, contract, etc.)
 * or asks LlamaCloud to generate one for unknown types.
 */

import { task } from "@renderinc/sdk/workflows";
import { getLlamaClient } from "../shared/llama-client.js";
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
    docType: string,
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
      if (params && "data_schema" in params) {
        schema = (params as { data_schema: DataSchema }).data_schema;
      } else {
        schema = {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "Brief summary of the document content",
            },
            key_fields: {
              type: "array",
              items: { type: "string" },
              description: "Important data points found",
            },
          } as Record<string, unknown>,
        };
      }
    }

    const result = await client.extract.run({
      file_input: fileId,
      configuration: {
        data_schema: schema,
        confidence_scores: true,
      },
    });

    const extractResult = result.extract_result;
    const extractedData: Record<string, unknown> =
      extractResult && !Array.isArray(extractResult) ? extractResult : {};

    return {
      extractedData,
      schemaUsed: schema,
    };
  },
);
