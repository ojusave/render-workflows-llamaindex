/**
 * Placeholder embedding for development and demo purposes.
 * Generates a deterministic 1536-dim vector from character codes.
 * Swap this for a real embedding API (OpenAI, Cohere, etc.) in production.
 */

const EMBEDDING_DIM = 1536;
export function placeholderEmbedding(text: string): number[] {
  const vec = new Float64Array(EMBEDDING_DIM);
  for (let i = 0; i < text.length; i++) {
    vec[i % EMBEDDING_DIM] += text.charCodeAt(i) / 1000;
  }
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}
