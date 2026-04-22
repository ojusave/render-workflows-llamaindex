/**
 * Workflow task: classify a document against known types using LlamaCloud Classify API.
 * Returns the best-matching type, confidence score, and reasoning.
 */

import { task } from "@renderinc/sdk/workflows";
import { getLlamaClient } from "../shared/llama-client.js";

const CLASSIFICATION_RULES = [
  { type: "invoice", description: "Contains invoice number, vendor/seller info, line items, total amount due, and payment terms" },
  { type: "contract", description: "Legal agreement between parties with terms, conditions, signatures, and effective dates" },
  { type: "report", description: "Analytical or summary document with findings, data analysis, charts, or recommendations" },
  { type: "resume", description: "Personal career document listing work experience, education, skills, and contact information" },
  { type: "receipt", description: "Proof of purchase showing store name, items bought, prices, and transaction date" },
  { type: "letter", description: "Formal or informal correspondence with sender, recipient, date, greeting, and body text" },
  { type: "form", description: "Structured document with labeled fields, checkboxes, or blanks meant to be filled in" },
  { type: "academic", description: "Research paper, thesis, or scholarly article with abstract, citations, and references" },
  { type: "financial", description: "Bank statement, tax form, balance sheet, or other financial record with monetary figures" },
];

/**
 * Classify a document using LlamaCloud Classify API.
 * Returns the doc type, confidence score, and reasoning.
 */
export const classifyDocument = task(
  {
    name: "classify_document",
    plan: "starter",
    timeoutSeconds: 120,
    retry: { maxRetries: 2, waitDurationMs: 3000, backoffScaling: 2 },
  },
  async function classifyDocument(fileId: string): Promise<{
    docType: string;
    confidence: number;
    reasoning: string;
  }> {
    const client = getLlamaClient();

    console.log(`[classify] Starting classification for file: ${fileId}`);

    const response = await client.classify.run(
      {
        file_input: fileId,
        configuration: { rules: CLASSIFICATION_RULES },
      },
      { verbose: true }
    );

    console.log(`[classify] Job status: ${response.status}`);
    console.log(`[classify] Result:`, JSON.stringify(response.result, null, 2));

    if (response.status === "FAILED") {
      const errorMsg = response.error_message ?? "Classification failed";
      console.error(`[classify] Error: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // If result is null, classification completed but didn't match any rule
    if (!response.result) {
      console.log(`[classify] No classification result - document may not match any rules`);
      return {
        docType: "general",
        confidence: 0,
        reasoning: "Document did not strongly match any predefined category",
      };
    }

    return {
      docType: response.result.type ?? "general",
      confidence: response.result.confidence ?? 0,
      reasoning: response.result.reasoning ?? "",
    };
  }
);
