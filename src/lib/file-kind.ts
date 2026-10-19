// What uploaded files may be and how they're served. The content type is
// always derived from the filename's extension on this allowlist — never from
// what the client claimed at upload — so an uploaded .html can't be served as
// a page on our origin.

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

const DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  zip: "application/zip",
  step: "application/octet-stream",
  stp: "application/octet-stream",
  stl: "application/octet-stream",
  "3mf": "application/octet-stream",
  kicad_sym: "application/octet-stream",
  kicad_mod: "application/octet-stream",
};

export type FileKind = "image" | "document";

function extension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/** The kind of an allowed upload, or null when the extension isn't allowed. */
export function fileKind(filename: string): FileKind | null {
  const ext = extension(filename);
  if (ext in IMAGE_TYPES) return "image";
  if (ext in DOCUMENT_TYPES) return "document";
  return null;
}

export function contentTypeFor(filename: string): string {
  const ext = extension(filename);
  return IMAGE_TYPES[ext] ?? DOCUMENT_TYPES[ext] ?? "application/octet-stream";
}

// Images and PDFs open in the browser; everything else downloads. SVG is
// deliberately absent from IMAGE_TYPES: it can carry script.
export function isInline(filename: string): boolean {
  const ext = extension(filename);
  return ext in IMAGE_TYPES || ext === "pdf" || ext === "txt";
}

export const ACCEPTED_UPLOADS = [
  ...Object.keys(IMAGE_TYPES),
  ...Object.keys(DOCUMENT_TYPES),
]
  .map((ext) => `.${ext}`)
  .join(",");

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
