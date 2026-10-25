"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, PackagePlus, ScanBarcode } from "lucide-react";
import type { LocationOption } from "@/lib/location-tree";
import { parseLabelBarcode, type ScannedLabel } from "@/lib/label-barcode";
import { canUseCamera, createBarcodeDetector, type Detector } from "@/lib/barcode-detector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocationPicker } from "@/components/location-picker";
import { findPartByLabel } from "./actions";
import { changeStock } from "./stock-actions";

type Match = { id: string; name: string; unit: string; mpn: string } | null;

// Scan a distributor bag label (DigiKey, Mouser, LCSC, …) → book the received
// quantity onto the matching part, or start a new part prefilled from the
// label. After booking it's ready for the next bag.
export function ScanLabelDialog({ locations }: { locations: LocationOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [label, setLabel] = useState<ScannedLabel | null>(null);
  const [match, setMatch] = useState<Match>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [camera, setCamera] = useState(false);
  const [pending, startTransition] = useTransition();

  function reset() {
    setRaw("");
    setLabel(null);
    setMatch(null);
    setQuantity("");
  }

  function handleScan(text: string) {
    const parsed = parseLabelBarcode(text);
    if (!parsed) {
      toast.error("Not a supplier label (EIGP 114 or LCSC) — or the scanner dropped its separators");
      setRaw("");
      return;
    }
    startTransition(async () => {
      const result = await findPartByLabel({
        mpn: parsed.mpn,
        supplierPartNumber: parsed.supplierPartNumber,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setLabel(parsed);
      setMatch(result.part ?? null);
      setQuantity(parsed.quantity === null ? "" : String(parsed.quantity));
    });
  }

  function book() {
    if (!label || !match || !locationId) return;
    startTransition(async () => {
      const note = [
        `${label.supplier || "Supplier"} label`,
        label.purchaseOrder && `PO ${label.purchaseOrder}`,
        label.salesOrder && `order ${label.salesOrder}`,
      ]
        .filter(Boolean)
        .join(" · ");
      const result = await changeStock({ partId: match.id, locationId, mode: "add", quantity, note });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Added ${quantity} ${match.unit} of ${match.name}`);
      reset(); // keep the location: the next bag usually goes to the same place
      router.refresh();
    });
  }

  const newPartHref = label
    ? `/parts/new?${new URLSearchParams({
        mpn: label.mpn || label.supplierPartNumber,
        manufacturer: label.manufacturer,
        orderUrl: label.orderUrl,
        ...(label.quantity !== null ? { qty: String(label.quantity) } : {}),
      })}`
    : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset();
          setCamera(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <ScanBarcode className="size-4" />
          Scan label
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scan a bag label</DialogTitle>
          <DialogDescription>
            The 2D code on DigiKey, Mouser, LCSC and other distributor bags. Use a scanner (focus the
            field below) or the camera.
          </DialogDescription>
        </DialogHeader>

        {!label ? (
          <div className="grid gap-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (raw.trim()) handleScan(raw);
              }}
            >
              <Input
                autoFocus
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                onKeyDown={(e) => {
                  const sep = controlCharFor(e);
                  if (sep) {
                    e.preventDefault();
                    setRaw((prev) => prev + sep);
                  }
                }}
                placeholder="Scan now…"
                aria-label="Scanned label"
                className="font-mono"
                disabled={pending}
              />
            </form>
            {camera ? (
              <CameraScanner
                onResult={(text) => {
                  setCamera(false);
                  handleScan(text);
                }}
                onError={(message) => {
                  setCamera(false);
                  toast.error(message);
                }}
              />
            ) : (
              canUseCamera() && (
                <Button variant="outline" onClick={() => setCamera(true)}>
                  <Camera className="size-4" />
                  Use camera
                </Button>
              )
            )}
          </div>
        ) : (
          <div className="grid gap-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {label.supplier && <Field label="Supplier" value={label.supplier} />}
              <Field label="MPN" value={label.mpn} mono />
              {label.supplierPartNumber && <Field label="Supplier PN" value={label.supplierPartNumber} mono />}
              {label.manufacturer && <Field label="Manufacturer" value={label.manufacturer} />}
              {label.purchaseOrder && <Field label="PO" value={label.purchaseOrder} />}
            </dl>
            {match ? (
              <>
                <p>
                  Part:{" "}
                  <Link href={`/parts/${match.id}`} className="font-medium underline">
                    {match.name}
                  </Link>
                </p>
                <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                  <div className="grid gap-2">
                    <Label>Put into</Label>
                    <LocationPicker locations={locations} value={locationId} onChange={setLocationId} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="scan-qty">Quantity</Label>
                    <Input
                      id="scan-qty"
                      type="number"
                      min={1}
                      step={1}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No part with this MPN yet.</p>
            )}
          </div>
        )}

        {label && (
          <DialogFooter>
            <Button variant="outline" onClick={reset}>
              Scan another
            </Button>
            {match ? (
              <Button onClick={book} disabled={pending || !locationId || !quantity}>
                {pending ? "Adding…" : "Add to stock"}
              </Button>
            ) : (
              <Button asChild>
                <Link href={newPartHref}>
                  <PackagePlus className="size-4" />
                  Create part
                </Link>
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono" : undefined}>{value || "—"}</dd>
    </>
  );
}

// A keyboard-mode scanner "types" the label's separators as Ctrl+] (GS),
// Ctrl+^ (RS) and Ctrl+D (EOT); browsers would drop them (or bookmark the
// page), so they're caught and inserted by hand.
function controlCharFor(e: React.KeyboardEvent): string | null {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.code === "BracketRight" || e.key === "]") return "\x1d";
  if (e.code === "Digit6" || e.key === "^" || e.key === "6") return "\x1e";
  if (e.code === "KeyD" || e.key.toLowerCase() === "d") return "\x04";
  return null;
}

// --- Camera -------------------------------------------------------------------

// Reads a Data Matrix/QR code from the rear camera — with the browser's own
// BarcodeDetector where there is one, else the ZXing ponyfill (iOS/iPadOS).
function CameraScanner({
  onResult,
  onError,
}: {
  onResult: (text: string) => void;
  onError: (message: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  // Latest callbacks without restarting the camera when the parent re-renders.
  const callbacks = useRef({ onResult, onError });
  useEffect(() => {
    callbacks.current = { onResult, onError };
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let detector: Detector | null = null;

    async function tick() {
      if (stopped || !video.current || !detector) return;
      try {
        const [code] = await detector.detect(video.current);
        if (code?.rawValue && !stopped) return callbacks.current.onResult(code.rawValue);
      } catch {
        // A frame that isn't ready yet; try the next one.
      }
      timer = setTimeout(tick, 250);
    }

    // Open the camera and load the detector in parallel; the ZXing .wasm is
    // ~1 MB on first use.
    Promise.all([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((s) => {
        stream = s;
        if (stopped) s.getTracks().forEach((t) => t.stop());
        return s;
      }),
      createBarcodeDetector(["data_matrix", "qr_code"]),
    ])
      .then(async ([s, d]) => {
        if (stopped || !video.current) return;
        detector = d;
        video.current.srcObject = s;
        await video.current.play();
        tick();
      })
      .catch((err: unknown) => {
        if (stopped) return;
        const denied = err instanceof DOMException && err.name === "NotAllowedError";
        callbacks.current.onError(
          denied ? "Camera access was denied — allow it in the browser's site settings" : "Could not open the camera",
        );
      });

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return <video ref={video} muted playsInline className="aspect-video w-full rounded-md bg-black object-cover" />;
}
