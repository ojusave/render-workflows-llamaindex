/**
 * Render Workflows enforces a ~4MB per-task argument payload limit (see `workflows-limits` in the docs).
 * The upload task receives the file as a base64 string, which inflates size by a factor of 4/3.
 * Keep raw file size at or below 3 MiB so the `startTask` JSON payload for `upload_to_llamacloud` stays under the cap.
 */

/** Max raw file bytes (3 MiB) safe to pass to `upload_to_llamacloud` as base64 in task args. */
export const MAX_WORKFLOW_UPLOAD_BYTES = 3 * 1024 * 1024;

/**
 * Effective max upload: env may set a lower cap; never above workflow limit.
 */
export function resolveMaxUploadBytes(): number {
  const raw = process.env.MAX_UPLOAD_BYTES?.trim();
  if (!raw) {
    return MAX_WORKFLOW_UPLOAD_BYTES;
  }
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) {
    return MAX_WORKFLOW_UPLOAD_BYTES;
  }
  return Math.min(n, MAX_WORKFLOW_UPLOAD_BYTES);
}
