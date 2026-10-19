// Client-side upload to the part files route (a route handler, since server
// actions cap bodies at 1 MB).
export async function uploadPartFiles(partId: string, uploads: File[]): Promise<{ error?: string }> {
  const body = new FormData();
  for (const file of uploads) body.append("files", file);
  const res = await fetch(`/api/parts/${partId}/files`, { method: "POST", body });
  if (res.ok) return {};
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return { error: data?.error ?? `Upload failed (${res.status})` };
}
