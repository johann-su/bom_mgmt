import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { UserRole } from "@/lib/roles";
import type { PartAttribute } from "@/lib/part-attributes";
import type { MovementKind } from "@/lib/stock";
import type { LabelTemplate } from "@/lib/label-template";

// --- BetterAuth tables ---
// Property names must stay as spelled: the drizzle adapter looks each
// model/field up by name (see the `schema` map in src/lib/auth.ts).

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Instance-wide role: admins additionally manage users under
  // Settings → Users. See src/lib/roles.ts; first admin via src/lib/admin.ts.
  role: text("role").$type<UserRole>().notNull().default("user"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// --- Storage locations ---
//
// The hierarchy (Shelf A → Box 1 → Bin I) is a plain tree of `locations`.
// What a node *is* comes from its `location_types` row, which also owns the
// label pattern its members are named by (see src/lib/label-pattern.ts). Types
// don't constrain nesting — a shelf can hold boxes and loose drawers alike —
// so the tree can be as regular or as ad hoc as the workshop.

export const locationTypes = pgTable("location_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  // Label pattern source, e.g. "{A}", "{N}", "{R}", "{A}{N:1-6}".
  labelPattern: text("label_pattern").notNull(),
  // A lucide icon name from LOCATION_ICONS (src/lib/location-icons.ts).
  icon: text("icon").notNull().default("box"),
  position: integer("position").notNull().default(0),
  // The printable label every location of this type gets (shown on the
  // location page). Null = the built-in default (src/lib/label-template.ts).
  labelTemplateId: uuid("label_template_id").references((): AnyPgColumn => labelTemplates.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Deleting a location with children is refused in the action; the FK
    // restricts too so a stray delete can't orphan a subtree.
    parentId: uuid("parent_id").references((): AnyPgColumn => locations.id, {
      onDelete: "restrict",
    }),
    typeId: uuid("type_id")
      .notNull()
      .references(() => locationTypes.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    // Optional human name next to the label ("Fasteners", "SMD passives").
    name: text("name").notNull().default(""),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Siblings can't share a label, whatever their types — the code (A/2/IX)
    // is the chain of labels, so this keeps it a unique address from root to
    // leaf. NULLS NOT DISTINCT makes the rule hold for top-level locations
    // (parent_id null) too.
    unique("locations_sibling_label").on(t.parentId, t.label).nullsNotDistinct(),
    index("locations_parent_idx").on(t.parentId),
  ],
);

// Printable label designs for locations (see src/lib/label-template.ts).
// The JSON is validated by parseTemplate on every write.
export const labelTemplates = pgTable("label_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  template: jsonb("template").$type<LabelTemplate>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// --- Parts ---

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const parts = pgTable(
  "parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    manufacturer: text("manufacturer").notNull().default(""),
    // Manufacturer part number — the key BOM imports match on first.
    mpn: text("mpn").notNull().default(""),
    // Unit stock is counted in ("pcs", "m", "g"); quantities are integers, so
    // pick a unit small enough (cm of wire, g of solder).
    unit: text("unit").notNull().default("pcs"),
    // Low-stock threshold across all locations; null = not tracked.
    minStock: integer("min_stock"),
    // Where to reorder the part (a shop/supplier page); "" = none. Shown as
    // an "Order" link, prominently once stock runs low.
    orderUrl: text("order_url").notNull().default(""),
    attributes: jsonb("attributes").$type<PartAttribute[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("parts_category_idx").on(t.categoryId),
    index("parts_mpn_idx").on(sql`lower(${t.mpn})`),
  ],
);

// Images and documents (datasheets) attached to a part. The first image by
// position is the part's thumbnail.
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    kind: text("kind").$type<"image" | "document">().notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("files_part_idx").on(t.partId)],
);

// How many of a part sit in one location. A part may be spread over several
// locations; a row at quantity 0 is kept so the part's "home" isn't forgotten
// when the bin runs empty.
export const stock = pgTable(
  "stock",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("stock_part_location").on(t.partId, t.locationId),
    index("stock_location_idx").on(t.locationId),
    check("stock_quantity_nonnegative", sql`${t.quantity} >= 0`),
  ],
);

// Append-only audit log of every stock change. Location references are
// nulled (not cascaded) when a location goes, so history survives; the
// labels at the time are kept in `locationPath` for that case.
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    kind: text("kind").$type<MovementKind>().notNull(),
    // Signed change at `locationId` (+ for add, − for remove/build). For a
    // move it is the (positive) amount that went from → to.
    quantity: integer("quantity").notNull(),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    toLocationId: uuid("to_location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    locationPath: text("location_path").notNull().default(""),
    toLocationPath: text("to_location_path").notNull().default(""),
    bomId: uuid("bom_id").references((): AnyPgColumn => boms.id, { onDelete: "set null" }),
    note: text("note").notNull().default(""),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("stock_movements_part_idx").on(t.partId, t.createdAt),
    index("stock_movements_created_idx").on(t.createdAt),
  ],
);

// --- Bills of materials ---

export const boms = pgTable("boms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const bomItems = pgTable(
  "bom_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bomId: uuid("bom_id")
      .notNull()
      .references(() => boms.id, { onDelete: "cascade" }),
    // A part used in a BOM can't be deleted out from under it.
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    // Quantity per built unit.
    quantity: integer("quantity").notNull(),
    // Reference designators or where it goes ("R1, R2", "lid screws").
    reference: text("reference").notNull().default(""),
    notes: text("notes").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    unique("bom_items_bom_part").on(t.bomId, t.partId),
    check("bom_items_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

// --- Relations ---

export const locationTypesRelations = relations(locationTypes, ({ many }) => ({
  locations: many(locations),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  parent: one(locations, {
    fields: [locations.parentId],
    references: [locations.id],
    relationName: "parent",
  }),
  children: many(locations, { relationName: "parent" }),
  type: one(locationTypes, {
    fields: [locations.typeId],
    references: [locationTypes.id],
  }),
  stock: many(stock),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  parts: many(parts),
}));

export const partsRelations = relations(parts, ({ one, many }) => ({
  category: one(categories, {
    fields: [parts.categoryId],
    references: [categories.id],
  }),
  files: many(files),
  stock: many(stock),
  movements: many(stockMovements),
  bomItems: many(bomItems),
}));

export const filesRelations = relations(files, ({ one }) => ({
  part: one(parts, { fields: [files.partId], references: [parts.id] }),
}));

export const stockRelations = relations(stock, ({ one }) => ({
  part: one(parts, { fields: [stock.partId], references: [parts.id] }),
  location: one(locations, {
    fields: [stock.locationId],
    references: [locations.id],
  }),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  part: one(parts, { fields: [stockMovements.partId], references: [parts.id] }),
  user: one(user, { fields: [stockMovements.userId], references: [user.id] }),
  bom: one(boms, { fields: [stockMovements.bomId], references: [boms.id] }),
}));

export const bomsRelations = relations(boms, ({ many }) => ({
  items: many(bomItems),
}));

export const bomItemsRelations = relations(bomItems, ({ one }) => ({
  bom: one(boms, { fields: [bomItems.bomId], references: [boms.id] }),
  part: one(parts, { fields: [bomItems.partId], references: [parts.id] }),
}));
