"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Bluetooth, Printer, Unplug, Usb } from "lucide-react";
import type {
  NiimbotAbstractClient,
  NiimbotSerialClientConnectOptions,
  PrintTaskName,
} from "@mmote/niimbluelib";
import { pageSize, type LabelTemplate, type LabelVariables } from "@/lib/label-template";
import { renderPages } from "@/lib/label-render";
import { svgToCanvas } from "@/lib/label-export";
import {
  printheadProblem,
  rasterSize,
  toMonochrome,
  type PrintDirection,
} from "@/lib/niimbot-raster";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Lib = typeof import("@mmote/niimbluelib");

// USB vendor id of the YICHIP USB-serial chip in NIIMBOT printers (seen on a
// D110_M). The port picker is filtered to it because macOS also lists a
// Bluetooth-Classic port named after a paired printer ("D110_M-…") that
// looks right but never answers — the "Other USB port" button drops the
// filter for models with a different chip.
const NIIMBOT_USB_VENDOR_ID = 0x3513;

// Web Serial isn't in TypeScript's DOM lib; only requestPort is needed.
type SerialApi = {
  requestPort(options?: { filters?: { usbVendorId?: number }[] }): Promise<
    NiimbotSerialClientConnectOptions["authorizedPort"]
  >;
};

type Printer = {
  name: string;
  model: string | null;
  dpi: number;
  direction: PrintDirection;
  printheadPixels: number | null;
  density: { min: number; max: number; default: number };
  task: PrintTaskName | null;
  // Offered when the model isn't recognised and `task` must be picked by hand.
  taskNames: PrintTaskName[];
};

// Web Bluetooth/Serial exist only in Chromium browsers and only on HTTPS or
// localhost; read once on the client (false while server rendering).
const noSubscribe = () => () => {};
function useSupport() {
  return useSyncExternalStore(
    noSubscribe,
    () =>
      (window.isSecureContext ? 4 : 0) |
      ("bluetooth" in navigator ? 2 : 0) |
      ("serial" in navigator ? 1 : 0),
    () => -1,
  );
}

/**
 * Prints straight to a NIIMBOT label printer (B1, B21, D11, D110, …) over
 * Bluetooth or USB serial with niimbluelib. Each label is rendered with its
 * codes snapped to the printer's dot grid, rasterised at the printer's dpi
 * and thresholded to pure black/white before encoding.
 */
export function NiimbotPanel({
  template,
  labels,
}: {
  template: LabelTemplate;
  labels: LabelVariables[];
}) {
  const support = useSupport();
  const lib = useRef<Lib | null>(null);
  const client = useRef<NiimbotAbstractClient | null>(null);
  const stop = useRef(false);
  const [printer, setPrinter] = useState<Printer | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [density, setDensity] = useState(3);
  const [copies, setCopies] = useState(1);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Drop the connection when leaving the page.
  useEffect(() => () => void client.current?.disconnect(), []);

  if (support === -1) return null;
  const secure = (support & 4) !== 0;
  const bluetooth = (support & 2) !== 0;
  const serial = (support & 1) !== 0;

  async function connect(transport: "bluetooth" | "serial", anyPort = false) {
    setConnecting(true);
    try {
      // Ask for the port first: the picker must open straight from the click
      // (user activation), before any awaited import.
      const port =
        transport === "serial"
          ? await (navigator as Navigator & { serial: SerialApi }).serial.requestPort(
              anyPort ? {} : { filters: [{ usbVendorId: NIIMBOT_USB_VENDOR_ID }] },
            )
          : undefined;
      lib.current ??= await import("@mmote/niimbluelib");
      await client.current?.disconnect();
      const c =
        transport === "serial"
          ? new lib.current.NiimbotSerialClient()
          : lib.current.instantiateClient(transport);
      c.on("disconnect", () => {
        if (client.current === c) {
          client.current = null;
          setPrinter(null);
        }
      });
      const info =
        c instanceof lib.current.NiimbotSerialClient
          ? await c.connect({ authorizedPort: port })
          : await c.connect();
      client.current = c;
      const meta = c.getModelMetadata();
      setPrinter({
        name: info.deviceName ?? meta?.model ?? "NIIMBOT",
        model: meta?.model ?? null,
        dpi: meta?.dpi ?? 203,
        direction: meta?.printDirection ?? "left",
        printheadPixels: meta?.printheadPixels ?? null,
        density: meta
          ? { min: meta.densityMin, max: meta.densityMax, default: meta.densityDefault }
          : { min: 1, max: 5, default: 3 },
        task: c.getPrintTaskType() ?? null,
        taskNames: lib.current.printTaskNames,
      });
      setDensity(meta?.densityDefault ?? 3);
    } catch (err) {
      // Closing the browser's device picker is not an error worth a toast.
      if (!(err instanceof DOMException && err.name === "NotFoundError")) {
        console.error(err);
        const message = err instanceof Error ? err.message : String(err);
        // The port opened but nothing answered the handshake: almost always
        // the wrong entry in the port picker, or a USB cable/port that only
        // charges the printer.
        const silent = /negotiate|timeout/i.test(message);
        toast.error(
          silent
            ? "The printer didn't answer"
            : `Couldn't connect: ${message}`,
          silent
            ? {
                description:
                  transport === "serial"
                    ? "Check it's switched on and that you picked its USB port (on macOS: usbmodem…) — not the Bluetooth one named after the printer. Some models only charge over USB; try Bluetooth."
                    : "Check it's switched on, not connected to the phone app, and close enough.",
                duration: 15_000,
              }
            : undefined,
        );
      }
    } finally {
      setConnecting(false);
    }
  }

  async function print() {
    const c = client.current;
    const L = lib.current;
    if (!c || !L || !printer?.task) return;
    const size = pageSize(template);
    const { pages, errors } = renderPages(template, labels, 0, { pixelMm: 25.4 / printer.dpi });
    if (errors.length > 0) {
      toast.error(`${errors.length} label(s) have codes that can't be encoded — fix those first`);
      return;
    }
    stop.current = false;
    setProgress({ done: 0, total: pages.length });
    const task = c.protocol.newPrintTask(printer.task, {
      totalPages: pages.length * copies,
      density,
      statusPollIntervalMs: 100,
      statusTimeoutMs: 8_000,
    });
    try {
      await task.printInit();
      for (const [i, page] of pages.entries()) {
        if (stop.current) break;
        const canvas = await svgToCanvas(page, size, printer.dpi);
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        toMonochrome(pixels.data);
        ctx.putImageData(pixels, 0, 0);
        const encoded = L.ImageEncoder.encodeCanvas(canvas, L.PageColorType.SingleColor, printer.direction);
        await task.printPage(encoded, copies);
        await task.waitForPageFinished();
        setProgress({ done: i + 1, total: pages.length });
      }
      if (!stop.current) {
        await task.waitForFinished();
        toast.success(`Printed ${pages.length * copies} label${pages.length * copies === 1 ? "" : "s"}`);
      }
    } catch (err) {
      console.error(err);
      toast.error(`Printing failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await task.printEnd().catch(() => {});
      setProgress(null);
    }
  }

  const fit =
    printer?.printheadPixels != null
      ? printheadProblem(rasterSize(pageSize(template), printer.dpi), printer.printheadPixels, printer.direction)
      : null;
  const sheet = template.layout.kind === "sheet";
  const printing = progress !== null;

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-2">
        <Printer className="size-4 text-muted-foreground" />
        <h2 className="font-medium">NIIMBOT printer</h2>
        {printer && (
          <span className="ml-auto truncate text-sm text-muted-foreground">
            {printer.name}
            {printer.model && printer.model !== printer.name && ` · ${printer.model}`} · {printer.dpi} dpi
          </span>
        )}
      </div>

      {!secure ? (
        <p className="text-sm text-muted-foreground">
          Direct printing needs the app to be opened over HTTPS (or on localhost).
        </p>
      ) : !bluetooth && !serial ? (
        <p className="text-sm text-muted-foreground">
          This browser can&apos;t talk to printers. Use Chrome or Edge on a computer or Android —
          or download the PDF.
        </p>
      ) : !printer ? (
        <div className="flex flex-wrap gap-2">
          {bluetooth && (
            <Button variant="outline" disabled={connecting} onClick={() => connect("bluetooth")}>
              <Bluetooth className="size-4" />
              {connecting ? "Connecting…" : "Connect via Bluetooth"}
            </Button>
          )}
          {serial && (
            <>
              <Button variant="outline" disabled={connecting} onClick={() => connect("serial")}>
                <Usb className="size-4" />
                USB
              </Button>
              <Button
                variant="ghost"
                disabled={connecting}
                title="Show every serial port — for models whose USB chip isn't recognised"
                onClick={() => connect("serial", true)}
              >
                Other USB port…
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            {!printer.task && (
              <label className="grid gap-1 text-xs text-muted-foreground">
                <span>Model family (not detected)</span>
                <Select
                  value=""
                  onValueChange={(task) => setPrinter({ ...printer, task: task as PrintTaskName })}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {printer.taskNames.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <label className="grid w-24 gap-1 text-xs text-muted-foreground">
              <span>
                Density ({printer.density.min}–{printer.density.max})
              </span>
              <Input
                type="number"
                min={printer.density.min}
                max={printer.density.max}
                value={density}
                onChange={(e) =>
                  setDensity(
                    Math.min(printer.density.max, Math.max(printer.density.min, e.target.valueAsNumber || 0)),
                  )
                }
                className="h-9"
              />
            </label>
            <label className="grid w-20 gap-1 text-xs text-muted-foreground">
              <span>Copies</span>
              <Input
                type="number"
                min={1}
                max={99}
                value={copies}
                onChange={(e) => setCopies(Math.min(99, Math.max(1, e.target.valueAsNumber || 1)))}
                className="h-9"
              />
            </label>
            {printing ? (
              <Button variant="outline" onClick={() => (stop.current = true)}>
                Stop after {progress.done + 1}/{progress.total}
              </Button>
            ) : (
              <Button
                disabled={labels.length === 0 || sheet || !!fit || !printer.task}
                onClick={print}
              >
                <Printer className="size-4" />
                Print {labels.length * copies} label{labels.length * copies === 1 ? "" : "s"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Disconnect printer"
              disabled={printing}
              onClick={() => client.current?.disconnect()}
            >
              <Unplug className="size-4" />
            </Button>
          </div>
          {sheet && (
            <p className="text-sm text-destructive">
              This template is laid out for sheets — pick a one-label-per-page template sized to
              your NIIMBOT labels.
            </p>
          )}
          {fit && <p className="text-sm text-destructive">{fit}.</p>}
        </>
      )}
    </Card>
  );
}
