import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown, looksLikeHtml } from "@/lib/markdown";

test("shop HTML keeps its structure as Markdown: headings, bold labels, line breaks, rules", () => {
  // Trimmed from a real Shopify body_html (ruthex), editor spans and all.
  const html =
    '<p><strong>Bestellnummer:</strong><span> <meta charset="utf-8">GE-M3x57-001</span><br>' +
    "<strong>VPE:</strong><span> </span>100 Stück</p><hr>" +
    "<h3>✅ Vorteile</h3><p>🔧<span> </span><strong>Einfach:</strong><br>Per Lötkolben.</p>";
  assert.equal(
    htmlToMarkdown(html),
    "**Bestellnummer:** GE-M3x57-001\n**VPE:** 100 Stück\n\n---\n\n### ✅ Vorteile\n\n🔧 **Einfach:**\nPer Lötkolben.",
  );
});

test("lists and tables survive (GFM tables for spec sheets)", () => {
  const md = htmlToMarkdown(
    "<ul><li>PLA</li><li>PETG</li></ul>" +
      "<table><thead><tr><th>Thread</th><th>Length</th></tr></thead><tbody><tr><td>M3</td><td>5.7 mm</td></tr></tbody></table>",
  );
  assert.match(md, /^- +PLA\n- +PETG/);
  assert.match(md, /\| Thread \| Length \|\n\| --- \| --- \|\n\| M3 \| 5\.7 mm \|/);
});

test("scripts, styles and images are dropped — only the text is a description", () => {
  const md = htmlToMarkdown('<p>Hi<script>alert(1)</script><style>p{}</style><img src="x.png"></p>');
  assert.equal(md, "Hi");
});

test("plain text passes through with its line breaks; 'a < b' isn't mistaken for HTML", () => {
  assert.equal(looksLikeHtml("R < 10 Ω, I > 1 A"), false);
  assert.equal(htmlToMarkdown("Line one  \r\nLine two\n\n\n\nPara"), "Line one\nLine two\n\nPara");
});
