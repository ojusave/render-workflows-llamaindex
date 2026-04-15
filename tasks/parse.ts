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
      expand: ["markdown", "text"],
    });

    const pages: Array<{ pageNumber: number; markdown: string }> = [];
    if (result.markdown?.pages) {
      for (const p of result.markdown.pages) {
        if ("markdown" in p && p.markdown) {
          pages.push({
            pageNumber: p.page_number ?? 0,
            markdown: p.markdown,
          });
        }
      }
    }

    const fullMarkdown = pages.map((p) => p.markdown).join("\n\n---\n\n");
    const fullText = result.text_full ?? "";

    return {
      markdown: fullMarkdown,
      text: fullText,
      pageCount: pages.length,
      pages,
    };
  }
);
