"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Star, Trash2, Upload } from "lucide-react";
import { ACCEPTED_UPLOADS } from "@/lib/file-kind";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { deletePartFile, makeCoverImage } from "../actions";
import { uploadPartFiles } from "../upload";

type PartFile = { id: string; filename: string; kind: "image" | "document"; size: number };

export function PartFiles({ partId, files }: { partId: string; files: PartFile[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const images = files.filter((f) => f.kind === "image");
  const documents = files.filter((f) => f.kind === "document");

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    const result = await uploadPartFiles(partId, [...list]);
    setUploading(false);
    if (input.current) input.current.value = "";
    if (result.error) toast.error(result.error);
    else toast.success(list.length === 1 ? "File uploaded" : `${list.length} files uploaded`);
    router.refresh();
  }

  function run(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
    });
  }

  return (
    <div className="grid gap-4">
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((image, index) => (
            <div key={image.id} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted">
              <a href={`/api/files/${image.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${image.id}`} alt={image.filename} className="size-full object-cover" />
              </a>
              <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {index > 0 && (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="size-7"
                    aria-label="Use as thumbnail"
                    title="Use as thumbnail"
                    disabled={pending}
                    onClick={() => run(() => makeCoverImage({ fileId: image.id }))}
                  >
                    <Star className="size-3.5" />
                  </Button>
                )}
                <ConfirmButton
                  title="Delete this image?"
                  confirmLabel="Delete"
                  onConfirm={() => run(() => deletePartFile({ fileId: image.id }))}
                >
                  <Button size="icon" variant="secondary" className="size-7" aria-label="Delete image">
                    <Trash2 className="size-3.5" />
                  </Button>
                </ConfirmButton>
              </div>
              {index === 0 && (
                <span className="absolute bottom-1 left-1 rounded bg-background/80 px-1.5 text-xs">
                  Thumbnail
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {documents.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <a
                href={`/api/files/${doc.id}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {doc.filename}
              </a>
              <span className="text-xs text-muted-foreground">{formatBytes(doc.size)}</span>
              <ConfirmButton
                title={`Delete ${doc.filename}?`}
                confirmLabel="Delete"
                onConfirm={() => run(() => deletePartFile({ fileId: doc.id }))}
              >
                <Button size="icon" variant="ghost" className="size-7" aria-label="Delete file">
                  <Trash2 className="size-3.5" />
                </Button>
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}

      {files.length === 0 && (
        <p className="text-sm text-muted-foreground">No images or datasheets yet.</p>
      )}

      <div>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPTED_UPLOADS}
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
        <Button variant="outline" size="sm" disabled={uploading} onClick={() => input.current?.click()}>
          <Upload className="size-4" />
          {uploading ? "Uploading…" : "Upload images or datasheets"}
        </Button>
      </div>
    </div>
  );
}
