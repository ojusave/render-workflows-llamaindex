/**
 * LlamaCloud retrieval for Ask / Search: chooses the right API by pipeline type.
 * `pipelines.retrieve` only works for MANAGED pipelines; UI-created pipelines are
 * usually PLAYGROUND and must use `retrievers.search` instead.
 */

import { getLlamaClient } from "./llama-client.js";

export type RetrievalHit = {
  text: string;
  score: number | null | undefined;
  metadata: Record<string, unknown>;
};

export async function retrieveFromConfiguredPipeline(
  pipelineId: string,
  query: string,
  topK: number,
  rerankN: number
): Promise<RetrievalHit[]> {
  const client = getLlamaClient();
  const meta = await client.pipelines.get(pipelineId);

  if (meta.pipeline_type === "MANAGED") {
    const result = await client.pipelines.retrieve(pipelineId, {
      query,
      retrieval_mode: "chunks",
      dense_similarity_top_k: topK,
      enable_reranking: true,
      rerank_top_n: rerankN,
    });
    return result.retrieval_nodes.map((node) => ({
      text: node.node.text ?? "",
      score: node.score,
      metadata: ((node.node as Record<string, unknown>).metadata ??
        {}) as Record<string, unknown>,
    }));
  }

  // PLAYGROUND (default in LlamaCloud UI) and any non-MANAGED type
  const composite = await client.retrievers.search({
    query,
    pipelines: [
      {
        pipeline_id: pipelineId,
        name: null,
        description: null,
        preset_retrieval_parameters: {
          retrieval_mode: "chunks",
          dense_similarity_top_k: topK,
          enable_reranking: true,
          rerank_top_n: rerankN,
        },
      },
    ],
    rerank_config: { top_n: rerankN, type: "system_default" },
  });

  const nodes = composite.nodes ?? [];
  return nodes.map((item) => {
    const inner = item.node;
    return {
      text: inner?.text ?? "",
      score: item.score,
      metadata: (inner?.metadata ?? {}) as Record<string, unknown>,
    };
  });
}
