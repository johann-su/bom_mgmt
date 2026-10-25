"use client";

import { useEffect, useRef } from "react";
import { createBarcodeDetector, type Detector } from "@/lib/barcode-detector";

// Reads a barcode in `formats` (BarcodeDetector names: "data_matrix",
// "qr_code", "code_128", …) from the rear camera — with the browser's own
// BarcodeDetector where there is one, else the ZXing ponyfill (iOS/iPadOS).
// Calls onResult once with the first code it reads; unmount to stop.
export function CameraScanner({
  formats,
  onResult,
  onError,
}: {
  formats: string[];
  onResult: (text: string) => void;
  onError: (message: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  // Latest props without restarting the camera when the parent re-renders.
  const props = useRef({ formats, onResult, onError });
  useEffect(() => {
    props.current = { formats, onResult, onError };
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
        if (code?.rawValue && !stopped) return props.current.onResult(code.rawValue);
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
      createBarcodeDetector(props.current.formats),
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
        props.current.onError(
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
