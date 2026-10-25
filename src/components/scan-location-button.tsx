"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, ScanLine } from "lucide-react";
import { canUseCamera } from "@/lib/barcode-detector";
import { findLocationByScan } from "@/app/locations/actions";
import { CameraScanner } from "@/components/camera-scanner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// Every symbology the label designer prints (SYMBOLOGIES in label-template.ts).
const LOCATION_FORMATS = ["data_matrix", "qr_code", "code_128", "code_39"];

// Scan a shelf/box/bin sticker from the label maker → open that location.
// On a phone the camera starts right away; on a desktop the field is focused
// for a hand-held scanner.
export function ScanLocationButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [raw, setRaw] = useState("");
  const [pending, startTransition] = useTransition();

  function handleScan(text: string) {
    startTransition(async () => {
      const result = await findLocationByScan(text);
      if (!result.id) {
        toast.error(result.error ?? "No matching location");
        setRaw("");
        return;
      }
      setOpen(false);
      setCamera(false);
      setRaw("");
      router.push(`/locations/${result.id}`);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setRaw("");
        setCamera(next && canUseCamera() && window.matchMedia("(pointer: coarse)").matches);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Scan location label" title="Scan location label">
          <ScanLine className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scan a location label</DialogTitle>
          <DialogDescription>
            The Data Matrix, QR or barcode on a shelf, box or bin label from the label maker.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {camera ? (
            <CameraScanner
              formats={LOCATION_FORMATS}
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
              <Button variant="outline" onClick={() => setCamera(true)} disabled={pending}>
                <Camera className="size-4" />
                Use camera
              </Button>
            )
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (raw.trim()) handleScan(raw);
            }}
          >
            <Input
              autoFocus={!camera}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="Scan or type a code, e.g. A/1/IV"
              aria-label="Scanned location label"
              className="font-mono"
              disabled={pending}
            />
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
