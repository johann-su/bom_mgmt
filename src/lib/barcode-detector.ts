// A BarcodeDetector for the camera scanners. Browsers that ship the Shape
// Detection API (Chrome/Edge on Android and macOS) use their own; everywhere
// else — iOS/iPadOS Safari, Firefox, desktop Chrome on Windows/Linux — the
// `barcode-detector` ponyfill reads codes with ZXing compiled to WebAssembly.
//
// The ponyfill fetches its .wasm from jsDelivr by default, which the CSP's
// connect-src 'self' blocks, so the bundler emits the binary as a static asset
// and it's served from our own origin. Instantiating it needs
// 'wasm-unsafe-eval' in script-src (next.config.ts).

export type DetectedBarcode = { rawValue: string };

export type Detector = {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
};

type BarcodeDetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};

/** Whether this browser can open a camera at all (needs a secure context). */
export function canUseCamera(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** A detector for `formats` — native when it covers them, else the ponyfill. */
export async function createBarcodeDetector(formats: string[]): Promise<Detector> {
  const native = (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  if (native) {
    try {
      const supported = await native.getSupportedFormats();
      if (formats.every((f) => supported.includes(f))) return new native({ formats });
    } catch {
      // A stub without format support; fall through to the ponyfill.
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  const wasmUrl = new URL("zxing-wasm/reader/zxing_reader.wasm", import.meta.url).href;
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
    },
  });
  return new BarcodeDetector({ formats: formats as never });
}
