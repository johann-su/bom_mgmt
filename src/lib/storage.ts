import { randomUUID } from "node:crypto";
import { resolveStorageConfig, type BlobStore } from "@/lib/blob-store";
import { FsBlobStore } from "@/lib/blob-store-fs";
import { S3BlobStore } from "@/lib/blob-store-s3";

let store: BlobStore | undefined;

// The configured storage backend (see resolveStorageConfig), built on first
// use rather than at import so that merely importing this module has no side
// effects and a misconfiguration surfaces as an error where files are touched.
export function blobStore(): BlobStore {
  if (!store) {
    const config = resolveStorageConfig();
    store = config.backend === "filesystem" ? new FsBlobStore(config.root) : new S3BlobStore(config);
  }
  return store;
}

// A fresh storage key for an upload: one directory per file so the original
// (sanitized) name survives for downloads without colliding.
export function newStorageKey(filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "file";
  return `files/${randomUUID()}/${safeName}`;
}
