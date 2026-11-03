import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeCursor,
  DEFAULT_LIMIT,
  encodeCursor,
  parseMovementListQuery,
  parsePartListQuery,
  parseUnits,
  type PartListQuery,
} from "@/lib/api/params";

const parse = (qs: string) => parsePartListQuery(new URLSearchParams(qs));
const ok = (qs: string) => {
  const result = parse(qs);
  assert.ok(!("error" in result), `expected ${qs} to parse`);
  return result as PartListQuery;
};
const fails = (result: object) => assert.ok("error" in result);
const ID = "0b5e7d3a-8d0e-4b9e-9a51-2f6f0c1d2e3f";

// Name order is the app's own parts list order, so it is the default.
test("an empty query is the first page by name", () => {
  const q = ok("");
  assert.equal(q.sort, "name_asc");
  assert.equal(q.limit, DEFAULT_LIMIT);
  assert.equal(q.cursor, null);
  assert.equal(q.lowStock, false);
});

// Cursors carry Postgres' microsecond text form: a JS Date would round to
// milliseconds and skip rows created within the same millisecond as a page
// boundary.
test("a timestamp cursor round-trips with microsecond precision", () => {
  const raw = encodeCursor("updated_asc", "2026-11-02 14:22:44.116789", ID);
  assert.deepEqual(decodeCursor(raw, "updated_asc"), {
    sort: "updated_asc",
    at: "2026-11-02 14:22:44.116789",
    id: ID,
  });
});

// Name-sorted pages continue after the last name, which may be any text.
test("a name cursor carries the name as is", () => {
  const raw = encodeCursor("name_asc", "M3×8 screw, ISO 4762", ID);
  assert.equal(decodeCursor(raw, "name_asc")?.at, "M3×8 screw, ISO 4762");
});

// Reading one sort's cursor as another's would page through the wrong order,
// and a forged timestamp must not reach the SQL cast.
test("a cursor from another sort, or a forged one, is rejected", () => {
  const raw = encodeCursor("created_desc", "2026-11-02 14:22:44.116789", ID);
  fails(parse(`sort=updated_desc&cursor=${raw}`));
  const forged = Buffer.from(JSON.stringify({ s: "created_desc", a: "now()", i: ID })).toString("base64url");
  assert.equal(decodeCursor(forged, "created_desc"), null);
  assert.equal(decodeCursor("not-base64-json", "name_asc"), null);
});

test("limit, sort and ids are validated", () => {
  fails(parse("limit=0"));
  fails(parse("limit=201"));
  fails(parse("limit=2.5"));
  fails(parse("sort=random"));
  fails(parse("category=7"));
  fails(parse("location=../x"));
  fails(parse("tracking=sometimes"));
});

// A typo'd flag must fail loudly rather than silently mean false.
test("boolean filters take true/false/1/0 only", () => {
  assert.equal(ok("lowStock=true").lowStock, true);
  assert.equal(ok("unsorted=1").unsorted, true);
  assert.equal(ok("lowStock=false").lowStock, false);
  fails(parse("lowStock=yes"));
});

test("updatedSince must be a timestamp", () => {
  assert.equal(ok("updatedSince=2026-11-01T00:00:00Z").updatedSince?.toISOString(), "2026-11-01T00:00:00.000Z");
  fails(parse("updatedSince=yesterday"));
});

// The movement log defaults to newest first; polling uses created_asc + since.
test("movement queries default to newest first and validate their filters", () => {
  const q = parseMovementListQuery(new URLSearchParams(""));
  assert.ok(!("error" in q));
  assert.equal(q.sort, "created_desc");
  const poll = parseMovementListQuery(new URLSearchParams(`sort=created_asc&since=2026-11-01T00:00:00Z&part=${ID}`));
  assert.ok(!("error" in poll));
  assert.equal(poll.partId, ID);
  fails(parseMovementListQuery(new URLSearchParams("sort=name_asc")));
  fails(parseMovementListQuery(new URLSearchParams("kind=steal")));
  fails(parseMovementListQuery(new URLSearchParams("bom=nope")));
});

test("units default to 1 and must be a positive integer", () => {
  assert.equal(parseUnits(null), 1);
  assert.equal(parseUnits("25"), 25);
  fails(parseUnits("0") as object);
  fails(parseUnits("1.5") as object);
});
