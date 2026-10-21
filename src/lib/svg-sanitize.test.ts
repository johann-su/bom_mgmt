import { test } from "node:test";
import assert from "node:assert/strict";
import { importSvg, sanitizeSvgMarkup } from "@/lib/svg-sanitize";

const svg = (body: string, attrs = 'viewBox="0 0 24 24"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

function ok(source: string) {
  const result = importSvg(source);
  assert.ok(!("error" in result), "error" in result ? result.error : "");
  return result;
}

test("a plain icon keeps its shapes and viewBox; the root's paint moves onto a group", () => {
  // The shape of a lucide.dev "Copy SVG".
  const { viewBox, markup } = ok(
    svg('<path d="M12 2v20"/><circle cx="12" cy="12" r="4"/>', 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'),
  );
  assert.deepEqual(viewBox, [0, 0, 24, 24]);
  assert.match(markup, /^<g fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20"\/><circle /);
});

test("without a viewBox the width/height (any unit) become one", () => {
  assert.deepEqual(ok(svg('<rect width="1" height="1"/>', 'width="30mm" height="10mm"')).viewBox, [0, 0, 30, 10]);
  assert.ok("error" in importSvg(svg("<rect/>", "")));
});

test("scripts, event handlers, foreignObject and images never survive", () => {
  const { markup } = ok(
    svg(
      '<script>alert(1)</script><path d="M0 0" onclick="alert(1)" onload="x"/>' +
        '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>' +
        '<image href="https://evil.example/x.png"/><a href="javascript:alert(1)"><rect width="2" height="2"/></a>',
    ),
  );
  assert.doesNotMatch(markup, /script|onclick|onload|foreignObject|image|javascript|evil|<a\b/i);
  // The link's drawing is kept, just not the link.
  assert.match(markup, /<rect width="2" height="2"\/>/);
});

test("only local #references survive in href and url(); external ones are dropped", () => {
  const { markup } = ok(
    svg(
      '<defs><linearGradient id="a"><stop offset="0" stop-color="#000"/></linearGradient></defs>' +
        '<rect fill="url(#a)" width="1" height="1"/><rect fill="url(https://evil.example/#a)" width="1" height="1"/>' +
        '<use href="https://evil.example/x.svg#a"/><use xlink:href="#a"/>' +
        '<rect style="fill: url(data:image/svg+xml,boom); stroke: red" width="1" height="1"/>',
    ),
  );
  assert.doesNotMatch(markup, /evil|data:|boom/);
  // Local references are renamed along with the ids they point at.
  const id = /id="([^"]+)"/.exec(markup)![1];
  assert.match(id, /^g\w+-a$/);
  assert.ok(markup.includes(`fill="url(#${id})"`));
  assert.ok(markup.includes(`<use href="#${id}"/>`));
  assert.match(markup, /stroke="red"/);
});

test("two different files get different id prefixes, so their gradients can't collide", () => {
  const a = ok(svg('<linearGradient id="g"/><rect fill="url(#g)"/>')).markup;
  const b = ok(svg('<linearGradient id="g"/><circle fill="url(#g)"/>')).markup;
  assert.notEqual(/id="([^"]+)"/.exec(a)![1], /id="([^"]+)"/.exec(b)![1]);
});

test("Illustrator-style <style> class rules are inlined; other CSS is not", () => {
  const { markup } = ok(
    svg(
      "<defs><style>.cls-1{fill:#e30613}.cls-1,.cls-2{stroke:#000}@import url(x.css);svg rect{fill:blue}</style></defs>" +
        '<path class="cls-1" d="M0 0h1"/><path class="cls-2" fill="#fff" style="fill:#00f" d="M1 1h1"/>',
    ),
  );
  assert.match(markup, /<path d="M0 0h1" fill="#e30613" stroke="#000"\/>/);
  // Precedence: attribute < class rule < style="".
  assert.match(markup, /<path fill="#00f" d="M1 1h1" stroke="#000"\/>/);
  assert.doesNotMatch(markup, /style|blue|import|class/);
});

test("markup is rebuilt and re-escaped, so attribute values can't break out", () => {
  const { markup } = ok(svg('<text x="1" y="2" font-family="a&quot;&gt;&lt;script&gt;">A &lt;b&gt; &amp; c</text>'));
  assert.doesNotMatch(markup, /<script/);
  assert.match(markup, /font-family="a&#34;&#62;&#60;script&#62;"/);
  assert.match(markup, />A &#60;b&#62; &#38; c<\/text>/);
});

test("editor metadata and namespaced junk are dropped; DOCTYPE entities aren't expanded", () => {
  const source =
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY boom "BOOM">]>' +
    svg('<sodipodi:namedview id="n"/><metadata><rdf:RDF/></metadata><text>&boom;</text><rect inkscape:label="x" width="1" height="1"/>');
  const { markup } = ok(source);
  assert.doesNotMatch(markup, /namedview|metadata|BOOM|inkscape/);
});

test("broken or non-SVG input is rejected rather than half-imported", () => {
  for (const bad of ["<html><body/></html>", "hello", svg("<g><path/>"), "<svg viewBox='0 0 1 1'><path d=x/></svg>"]) {
    assert.ok("error" in importSvg(bad), bad);
  }
  assert.ok("error" in importSvg(svg("<title>only a title</title>")));
});

test("sanitizeSvgMarkup leaves imported markup unchanged and still strips anything hostile", () => {
  const { markup } = ok(
    svg('<defs><linearGradient id="a" href="#b"/></defs><path fill="url(#a)" style="stroke:#000" d="M0 0"/><text>x &amp; y</text>'),
  );
  assert.equal(sanitizeSvgMarkup(markup), markup);
  // A tampered template saved straight to the server action.
  assert.equal(sanitizeSvgMarkup('<path d="M0 0" onload="alert(1)"/><script>x</script>'), '<path d="M0 0"/>');
  assert.equal(sanitizeSvgMarkup("<g><path/>"), null);
  assert.equal(sanitizeSvgMarkup("<script>x</script>"), null);
});
