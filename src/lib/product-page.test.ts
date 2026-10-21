import { test } from "node:test";
import assert from "node:assert/strict";
import { clean, extractProductInfo, mergeShopifyProduct, shopifyProductJsonUrl } from "@/lib/product-page";

const PAGE = "https://shop.example.com/products/ne555";

const jsonLd = (data: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`;

test("schema.org Product JSON-LD supplies name, brand, MPN, GTIN, price and image", () => {
  const info = extractProductInfo(
    jsonLd({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "NE555P Timer",
      description: "Precision timer, DIP-8",
      brand: { "@type": "Brand", name: "Texas Instruments" },
      mpn: "NE555P",
      sku: "296-1411-5-ND",
      gtin13: "0123456789012",
      image: ["/img/ne555.jpg"],
      offers: { "@type": "Offer", price: 0.42, priceCurrency: "EUR" },
    }),
    PAGE,
  );
  assert.deepEqual(info, {
    name: "NE555P Timer",
    description: "Precision timer, DIP-8",
    manufacturer: "Texas Instruments",
    mpn: "NE555P",
    sku: "296-1411-5-ND",
    gtin: "0123456789012",
    image: "https://shop.example.com/img/ne555.jpg", // relative URLs resolved against the page
    price: { amount: "0.42", currency: "EUR" },
  });
});

test("the product is found inside @graph / a WebPage, and manufacturer beats brand", () => {
  const info = extractProductInfo(
    jsonLd({
      "@graph": [
        { "@type": "BreadcrumbList", itemListElement: [] },
        {
          "@type": "WebPage",
          mainEntity: {
            "@type": ["Product", "Thing"],
            name: "Insert",
            brand: "ShopBrand",
            manufacturer: { name: "Ruthex" },
          },
        },
      ],
    }),
    PAGE,
  );
  assert.equal(info?.name, "Insert");
  assert.equal(info?.manufacturer, "Ruthex");
});

test("a broken JSON-LD block doesn't hide a later valid one; raw newlines in strings are tolerated", () => {
  const html =
    `<script type="application/ld+json">{ not json </script>` +
    `<script type='application/ld+json'>{"@type":"Product","name":"Line one\nline two"}</script>`;
  assert.equal(extractProductInfo(html, PAGE)?.name, "Line one line two");
});

test("OpenGraph product tags fill in when there is no JSON-LD", () => {
  const html = `
    <meta property="og:type" content="product">
    <meta property="og:title" content="Heat-set insert M3 &amp;amp; tool">
    <meta content="https://cdn.example.com/i.png" property="og:image">
    <meta property="product:price:amount" content="9.90">
    <meta property="product:price:currency" content="EUR">`;
  const info = extractProductInfo(html, PAGE);
  assert.equal(info?.name, "Heat-set insert M3 & tool", "double-escaped entities are decoded");
  assert.equal(info?.image, "https://cdn.example.com/i.png");
  assert.deepEqual(info?.price, { amount: "9.90", currency: "EUR" });
});

test("a page that isn't a product (a blog post's og:title) yields nothing", () => {
  const html = `<meta property="og:type" content="article"><meta property="og:title" content="Blog">`;
  assert.equal(extractProductInfo(html, PAGE), null);
});

test("a javascript: image URL is dropped — it would end up in an <img src>", () => {
  const info = extractProductInfo(jsonLd({ "@type": "Product", name: "x", image: "javascript:alert(1)" }), PAGE);
  assert.equal(info?.image, "");
});

test("clean strips tags, decodes numeric entities and collapses whitespace", () => {
  assert.equal(clean("<b>10&#160;k&#x3A9;</b>\n  resistor"), "10 kΩ resistor");
});

test("a JSON-LD description with (entity-escaped) markup becomes Markdown, not a run-on line", () => {
  const info = extractProductInfo(
    jsonLd({ "@type": "Product", name: "x", description: "&lt;p&gt;Brass insert&lt;/p&gt;&lt;ul&gt;&lt;li&gt;M3&lt;/li&gt;&lt;/ul&gt;" }),
    PAGE,
  );
  assert.match(info!.description, /^Brass insert\n\n- +M3$/);
});

test("a plain-text JSON-LD description keeps its line breaks", () => {
  const info = extractProductInfo(jsonLd({ "@type": "Product", name: "x", description: "Line one\nLine   two" }), PAGE);
  assert.equal(info?.description, "Line one\nLine two");
});

test("Shopify pages (also under /collections/…) map to the storefront's product JSON", () => {
  const html = '<script src="https://cdn.shopify.com/s/x.js"></script>';
  assert.equal(
    shopifyProductJsonUrl(html, "https://www.ruthex.de/collections/inserts/products/rx-m3?variant=5"),
    "https://www.ruthex.de/products/rx-m3.json",
  );
  assert.equal(shopifyProductJsonUrl("<html></html>", "https://shop.example.com/products/x"), null, "not Shopify");
});

test("Shopify JSON: body_html replaces the glued JSON-LD text; the ?variant= picks SKU and barcode", () => {
  const fromPage = extractProductInfo(
    jsonLd({ "@type": "Product", name: "ruthex M3", description: "Bestellnummer: GE-1Verpackungseinheit: 100" }),
    PAGE,
  );
  const merged = mergeShopifyProduct(
    fromPage,
    {
      product: {
        title: "ignored — the page's name stands",
        vendor: "ruthex",
        body_html: "<p><strong>Bestellnummer:</strong> GE-1<br><strong>Verpackungseinheit:</strong> 100</p>",
        variants: [
          { id: 1, sku: "GE-50", barcode: "111" },
          { id: 2, sku: "GE-100", barcode: "222" },
        ],
      },
    },
    "https://www.ruthex.de/products/rx-m3?variant=2",
  );
  assert.equal(merged?.name, "ruthex M3");
  assert.equal(merged?.description, "**Bestellnummer:** GE-1\n**Verpackungseinheit:** 100");
  assert.equal(merged?.manufacturer, "ruthex");
  assert.equal(merged?.sku, "GE-100");
  assert.equal(merged?.gtin, "222");
});

test("Shopify JSON that isn't a product leaves the page's data alone", () => {
  const fromPage = extractProductInfo(jsonLd({ "@type": "Product", name: "x" }), PAGE);
  assert.deepEqual(mergeShopifyProduct(fromPage, { errors: "Not found" }, PAGE), fromPage);
});
