import { test } from "node:test";
import assert from "node:assert/strict";
import {
  levelName,
  serializeFile,
  serializeMovement,
  serializePart,
  serializePartDetail,
  stockValue,
  type MovementRow,
  type PartRow,
} from "@/lib/api/serialize";

const url = (path: string) => `https://bins.example${path}`;
const created = new Date("2026-11-01T10:00:00Z");
const binIV = { id: "a0000000-0000-4000-8000-000000000004", code: "A/1/IV", path: "Shelf A › Box 1 › Bin IV" };
const binX = { id: "a0000000-0000-4000-8000-000000000010", code: "A/1/X", path: "Shelf A › Box 1 › Bin X" };

function partRow(over: Partial<PartRow> = {}): PartRow {
  return {
    id: "p0000000-0000-4000-8000-000000000001",
    name: "NE555 timer",
    mpn: "NE555P",
    manufacturer: "TI",
    category: { id: "c1", name: "ICs" },
    unit: "pcs",
    tracking: "exact",
    minStock: 10,
    orderUrls: [],
    icon: "",
    attributes: [],
    total: 12,
    stock: [],
    coverImageId: null,
    createdAt: created,
    updatedAt: created,
    ...over,
  };
}

// The serializer projects field by field: a storage key on the row must
// never reach a response.
test("internal file columns never leak into the response", () => {
  const row = {
    id: "f0000000-0000-4000-8000-000000000001",
    kind: "document" as const,
    filename: "ne555.pdf",
    size: 100,
    position: 0,
    createdAt: created,
    storageKey: "files/secret/ne555.pdf",
    partId: "p1",
  };
  const out = serializeFile(row, url) as Record<string, unknown>;
  assert.equal("storageKey" in out, false);
  assert.equal("partId" in out, false);
  assert.equal(out.downloadUrl, "https://bins.example/api/v1/files/f0000000-0000-4000-8000-000000000001");
});

// One shape for every tracking mode: a count, a level, or neither — never a
// number that means a count for one part and a level for the next.
test("stock values: counts for exact, level names for level/binary, nothing for untracked", () => {
  assert.deepEqual(stockValue("exact", 7), { quantity: 7, level: null });
  assert.deepEqual(stockValue("level", 1), { quantity: null, level: "low" });
  assert.deepEqual(stockValue("none", 0), { quantity: null, level: null });
  // Binary has no "low": anything above empty reads as in stock.
  assert.equal(levelName("binary", 1), "plenty");
  assert.equal(levelName("binary", 0), "empty");
});

test("lowStock follows the app's rule: below minStock, not at it", () => {
  assert.equal(serializePart(partRow({ total: 9 }), url).lowStock, true);
  assert.equal(serializePart(partRow({ total: 10 }), url).lowStock, false);
  assert.equal(serializePart(partRow({ minStock: null, total: 0 }), url).lowStock, false);
  assert.equal(serializePart(partRow({ tracking: "level", minStock: null, total: 1 }), url).lowStock, true);
});

// Where a part is: the unsorted pile first while it holds anything, then
// locations in natural code order; an emptied bin stays (it's the home).
test("stock entries: unsorted first, natural code order, empty homes kept", () => {
  const out = serializePart(
    partRow({
      stock: [
        { location: binX, quantity: 0 },
        { location: binIV, quantity: 5 },
        { location: null, quantity: 7 },
      ],
    }),
    url,
  );
  assert.deepEqual(
    out.stock.map((s) => [s.location?.code ?? null, s.quantity]),
    [
      [null, 7],
      ["A/1/IV", 5],
      ["A/1/X", 0],
    ],
  );
  const emptied = serializePart(partRow({ stock: [{ location: null, quantity: 0 }] }), url);
  assert.deepEqual(emptied.stock, []);
});

test("a part links to its page, its thumbnail and serializes timestamps as ISO", () => {
  const out = serializePart(partRow({ coverImageId: "f0000000-0000-4000-8000-000000000009" }), url);
  assert.equal(out.url, "https://bins.example/parts/p0000000-0000-4000-8000-000000000001");
  assert.equal(out.imageUrl, "https://bins.example/api/v1/files/f0000000-0000-4000-8000-000000000009");
  assert.equal(out.createdAt, "2026-11-01T10:00:00.000Z");
});

test("files come back in display order", () => {
  const file = (id: string, position: number) => ({ id, kind: "image" as const, filename: `${id}.png`, size: 1, position, createdAt: created });
  const out = serializePartDetail(
    { ...partRow(), description: "", notes: "", files: [file("b", 1), file("a", 0)], boms: [] },
    url,
  );
  assert.deepEqual(
    out.files.map((f) => f.id),
    ["a", "b"],
  );
});

function movementRow(over: Partial<MovementRow> = {}): MovementRow {
  return {
    id: "m1",
    kind: "add",
    quantity: 5,
    partId: "p1",
    partName: "NE555 timer",
    locationId: binIV.id,
    locationPath: "A/1/IV",
    toLocationId: null,
    toLocationPath: "",
    bomId: null,
    bomName: null,
    note: "",
    userId: "u1",
    userName: "Ada",
    createdAt: created,
    ...over,
  };
}

// A movement keeps the code a place had at the time: no id and no code is
// the unsorted pile; no id but a code is a location deleted since.
test("movement places: unsorted pile vs. a deleted location", () => {
  assert.deepEqual(serializeMovement(movementRow()).location, { id: binIV.id, code: "A/1/IV" });
  assert.equal(serializeMovement(movementRow({ locationId: null, locationPath: "" })).location, null);
  assert.deepEqual(serializeMovement(movementRow({ locationId: null })).location, { id: null, code: "A/1/IV" });
});

test("only moves have a destination; a deleted user or BOM reads as null", () => {
  assert.equal(serializeMovement(movementRow({ toLocationPath: "A/1/V" })).toLocation, null);
  const move = serializeMovement(movementRow({ kind: "move", toLocationId: null, toLocationPath: "" }));
  assert.equal(move.toLocation, null);
  const orphan = serializeMovement(movementRow({ kind: "build", userId: null, userName: null }));
  assert.equal(orphan.user, null);
  assert.equal(orphan.bom, null);
});
