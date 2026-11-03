"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Trash2 } from "lucide-react";
import { createApiKey, deleteApiKey } from "./actions";
import { formatDate } from "@/lib/format";
import { ALL_SCOPES, READ_ONLY_SCOPES, type ApiScope } from "@/lib/api/scopes";
import { ConfirmButton } from "@/components/confirm-button";
import { CopyField } from "@/components/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Dates cross the server/client boundary as ISO strings.
export type ApiKeyView = {
  id: string;
  name: string | null;
  start: string | null;
  scopes: ApiScope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  // Decided on the server, against one clock, so render stays pure.
  expired: boolean;
};

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];

export function ApiKeys({
  apiBase,
  scopes,
  keys,
}: {
  apiBase: string;
  scopes: { scope: ApiScope; description: string }[];
  keys: ApiKeyView[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<ApiScope[]>(READ_ONLY_SCOPES);
  const [expiry, setExpiry] = useState("90");
  const [busy, setBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // The secret of the key just created — shown once, then gone for good.
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);

  function toggle(scope: ApiScope, on: boolean) {
    setSelected((prev) =>
      on ? ALL_SCOPES.filter((s) => s === scope || prev.includes(s)) : prev.filter((s) => s !== scope),
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await createApiKey({
      name,
      scopes: selected,
      expiresInDays: expiry === "never" ? null : Number(expiry),
    });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setCreated({ name: name.trim(), key: res.key });
    setName("");
    router.refresh();
  }

  async function handleRevoke(apiKey: ApiKeyView) {
    setRevokingId(apiKey.id);
    const res = await deleteApiKey(apiKey.id);
    setRevokingId(null);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(`${apiKey.name ?? "Key"} revoked`);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-semibold mb-2">Using the API</h3>
        <Card>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">Base URL</div>
              <CopyField label="Base URL" value={apiBase} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">
                Send the key as a bearer token. The OpenAPI description at{" "}
                <a className="underline" href={`${apiBase}/openapi.json`}>
                  /api/v1/openapi.json
                </a>{" "}
                lists every endpoint.
              </div>
              <CopyField label="Example" value={`curl -H "Authorization: Bearer bv_…" "${apiBase}/parts?q=M3"`} />
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">Create a key</h3>
        <Card>
          <CardContent>
            {created ? (
              <div className="grid gap-3">
                <p className="text-sm">
                  <span className="font-medium">{created.name}</span> is ready. Copy it now — it
                  won&apos;t be shown again.
                </p>
                <CopyField label="API key" value={created.key} />
                <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setCreated(null)}>
                  Done
                </Button>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="api-key-name">Name</Label>
                  <Input
                    id="api-key-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Scanner station"
                    maxLength={64}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center gap-2">
                    <Label>Scopes</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-7"
                      onClick={() => setSelected(READ_ONLY_SCOPES)}
                    >
                      Read only
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={() => setSelected(ALL_SCOPES)}
                    >
                      Everything
                    </Button>
                  </div>
                  <div className="grid gap-2 rounded-lg border p-3">
                    {scopes.map(({ scope, description }) => (
                      <label key={scope} className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selected.includes(scope)}
                          onChange={(e) => toggle(scope, e.target.checked)}
                          className="mt-0.5 size-4 accent-primary"
                        />
                        <span className="grid gap-0.5">
                          <code className="text-xs font-medium">{scope}</code>
                          <span className="text-xs text-muted-foreground">{description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A write scope includes reading what it changes. <code>stock:write</code> without{" "}
                    <code>parts:write</code> suits a scanner or build station: it can count parts in and
                    out, but not edit or delete them.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label>Expires</Label>
                  <Select value={expiry} onValueChange={setExpiry}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="submit"
                  className="justify-self-start"
                  disabled={busy || !name.trim() || selected.length === 0}
                >
                  {busy ? "Creating…" : "Create key"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">Your keys</h3>
        {keys.length === 0 ? (
          <Card>
            <CardContent className="text-center text-sm text-muted-foreground">No keys yet.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {keys.map((apiKey) => (
              <Card key={apiKey.id}>
                <CardContent className="flex items-start gap-3">
                  <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{apiKey.name ?? "Unnamed key"}</span>
                      {apiKey.start && <code className="text-xs text-muted-foreground">{apiKey.start}…</code>}
                      {apiKey.expired && <Badge variant="outline">Expired</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {apiKey.scopes.length === 0 ? (
                        <Badge variant="outline">No scopes</Badge>
                      ) : (
                        apiKey.scopes.map((scope) => (
                          <Badge key={scope} variant="secondary" className="font-mono text-[11px]">
                            {scope}
                          </Badge>
                        ))
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Created {formatDate(new Date(apiKey.createdAt))} ·{" "}
                      {apiKey.lastUsedAt ? `last used ${formatDate(new Date(apiKey.lastUsedAt))}` : "never used"} ·{" "}
                      {apiKey.expiresAt
                        ? `${apiKey.expired ? "expired" : "expires"} ${formatDate(new Date(apiKey.expiresAt))}`
                        : "never expires"}
                    </div>
                  </div>
                  <ConfirmButton
                    title={`Revoke ${apiKey.name ?? "this key"}?`}
                    description="Anything using it stops working immediately. This can't be undone — create a new key to reconnect."
                    confirmLabel="Revoke key"
                    disabled={revokingId === apiKey.id}
                    onConfirm={() => handleRevoke(apiKey)}
                  >
                    <Button variant="outline" size="sm" className="shrink-0">
                      <Trash2 className="size-4" />
                      Revoke
                    </Button>
                  </ConfirmButton>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
