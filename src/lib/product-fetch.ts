// Fetches a shop's product page for "fill from order link". Every hop of a
// redirect chain is checked against src/lib/net-guard.ts before it's
// requested. (A DNS answer could still change between our lookup and fetch's
// own — acceptable for a signed-in-users-only feature; pin the address with a
// custom dispatcher if this is ever exposed more widely.)

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicAddress } from "@/lib/net-guard";
import {
  extractProductInfo,
  mergeShopifyProduct,
  shopifyProductJsonUrl,
  type ProductInfo,
} from "@/lib/product-page";

const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10_000;

// A plain browser-ish request; several shops return a stub page to unknown
// user agents.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export async function fetchProductInfo(
  url: string,
): Promise<{ product: ProductInfo } | { error: string }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const page = await guardedFetch(url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", signal);
    if ("error" in page) return page;
    if (!/html|xml/i.test(page.res.headers.get("content-type") ?? "")) {
      await page.res.body?.cancel();
      return { error: "The link is not a web page" };
    }
    const html = await readCapped(page.res);
    let product = extractProductInfo(html, page.url);

    const shopifyUrl = shopifyProductJsonUrl(html, page.url);
    if (shopifyUrl) {
      // Best effort: the page's own data still stands if this fails.
      const json = await guardedFetch(shopifyUrl, "application/json", signal).catch(() => null);
      if (json && "res" in json) {
        try {
          product = mergeShopifyProduct(product, JSON.parse(await readCapped(json.res)), page.url);
        } catch {}
      }
    }
    return product ? { product } : { error: "No product data found on that page" };
  } catch (err) {
    if (signal.aborted) return { error: "The shop took too long to answer" };
    return { error: `Could not load the page${err instanceof Error ? `: ${err.message}` : ""}` };
  }
}

// GET with redirects followed by hand, so every hop is checked; only a 2xx
// response comes back.
async function guardedFetch(
  url: string,
  accept: string,
  signal: AbortSignal,
): Promise<{ res: Response; url: string } | { error: string }> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { error: "Not a valid URL" };
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      return { error: "Only http(s) links can be read" };
    }
    if (!(await isPublicHost(current.hostname))) {
      return { error: "That address is not on the public internet" };
    }
    const res = await fetch(current, {
      headers: { "user-agent": USER_AGENT, accept, "accept-language": "en,de;q=0.8" },
      redirect: "manual",
      signal,
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, current);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      return {
        error:
          res.status === 403 || res.status === 429
            ? `The shop refused the request (${res.status}) — it blocks automated access`
            : `The shop answered ${res.status}`,
      };
    }
    return { res, url: current.href };
  }
  return { error: "Too many redirects" };
}

async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPublicAddress(host);
  const addresses = await lookup(host, { all: true });
  return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
}

// Product data sits in <head> or near the top, so a page over the cap is cut
// rather than rejected.
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel();
  return new TextDecoder().decode(Buffer.concat(chunks));
}
