/**
 * Singleton LlamaCloud client. Reads LLAMA_CLOUD_API_KEY from the environment
 * and reuses one instance across all workflow tasks.
 */

import LlamaCloud from "@llamaindex/llama-cloud";

let _client: LlamaCloud | null = null;

export function getLlamaClient(): LlamaCloud {
  if (!_client) {
    const apiKey = process.env.LLAMA_CLOUD_API_KEY;
    if (!apiKey) {
      throw new Error("LLAMA_CLOUD_API_KEY environment variable is required");
    }
    _client = new LlamaCloud({ apiKey });
  }
  return _client;
}
