// Part descriptions are Markdown. Shops and CSV exports hand us HTML (a
// Shopify body_html, a JSON-LD description with markup in it), which is
// converted here so the structure — headings, paragraphs, lists, tables,
// bold labels — survives instead of collapsing into one run-on line.

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

// Any element-looking tag; "a < b" or "<3" in plain text doesn't count.
const HTML_TAG = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i;

export function looksLikeHtml(text: string): boolean {
  return HTML_TAG.test(text);
}

let service: TurndownService | null = null;

function turndown(): TurndownService {
  if (service) return service;
  service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  service.use(gfm);
  // Page furniture and embeds carry no description text. Images would point
  // at the shop's CDN; the part has its own image files.
  service.remove(["script", "style", "meta", "link", "noscript", "iframe", "form", "button"]);
  // <img> has a built-in rule, which remove() doesn't override; <svg> isn't
  // in turndown's HTML tag typing.
  service.addRule("dropImages", {
    filter: (node) => node.nodeName === "IMG" || node.nodeName.toLowerCase() === "svg",
    replacement: () => "",
  });
  return service;
}

/**
 * Converts an HTML fragment to Markdown. Plain text passes through with only
 * its whitespace tidied, so this is safe to call on any description.
 */
export function htmlToMarkdown(input: string): string {
  if (!looksLikeHtml(input)) return tidy(input);
  // Rich-text editors wrap spaces in their own <span>s and mark-up
  // ("<strong>Label:</strong><span> </span>value"); non-breaking spaces would
  // also stop Markdown from recognising emphasis next to them.
  const html = input.replace(/&nbsp;| /g, " ");
  return tidy(turndown().turndown(html));
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n") // trailing spaces (but not Markdown hard breaks below)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\*\*(\s*)\*\*/g, "$1") // "<strong> </strong>" leaves empty bold markers
    .trim();
}
