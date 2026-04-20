/**
 * Infer file extension from Content-Type when the basename has none (LlamaCloud upload).
 */

import path from "path";

export function filenameWithExtFromContentType(
  basename: string,
  contentType: string | null | undefined
): string {
  if (path.extname(basename)) return basename;
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("pdf")) return `${basename}.pdf`;
  if (ct.includes("html")) return `${basename}.html`;
  if (ct.includes("markdown")) return `${basename}.md`;
  if (ct.includes("wordprocessingml") || ct.includes("msword")) return `${basename}.docx`;
  if (ct.includes("spreadsheetml") || ct.includes("excel")) return `${basename}.xlsx`;
  if (ct.includes("png")) return `${basename}.png`;
  if (ct.includes("jpeg") || ct.includes("jpg")) return `${basename}.jpg`;
  if (ct.startsWith("text/")) return `${basename}.txt`;
  return `${basename}.pdf`;
}
