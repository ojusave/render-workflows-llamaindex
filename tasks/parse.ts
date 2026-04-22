/**
 * Workflow task: parse a document into clean markdown using LlamaParse agentic tier.
 * Handles 130+ file formats. Returns per-page markdown, full text, and page count.
 */

import { task } from "@renderinc/sdk/workflows";
import { getLlamaClient } from "../shared/llama-client.js";
export const parseDocument = task(
  {
    name: "parse_document",
    plan: "standard",
    timeoutSeconds: 600,
    retry: { maxRetries: 2, waitDurationMs: 5000, backoffScaling: 2 },
  },
  async function parseDocument(fileId: string): Promise<{
    markdown: string;
    text: string;
    pageCount: number;
    pages: Array<{ pageNumber: number; markdown: string }>;
  }> {
    const client = getLlamaClient();

    const result = await client.parsing.parse({
      file_id: fileId,
      tier: "agentic",
      version: "latest",
      expand: ["markdown_full", "text_full", "items"],
    });

    const fullMarkdown = result.markdown_full ?? "";
    const fullText = result.text_full ?? "";
    
    // Extract page info from items if available
    const items = (result.items ?? []) as Array<{ page?: number; markdown?: string }>;
    const pages = items.map((item, idx) => ({
      pageNumber: item.page ?? idx + 1,
      markdown: item.markdown ?? "",
    }));
    const pageCount = pages.length > 0 ? pages.length : 1;

    return {
      markdown: fullMarkdown,
      text: fullText,
      pageCount,
      pages,
    };
  },
);
