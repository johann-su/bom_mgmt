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
import type { LabelSlots } from "@/lib/label-slots";

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

// --- OAuth provider tables (BetterAuth `jwt` + `@better-auth/mcp`) ---
//
// The MCP server (/api/mcp) authenticates LLM clients with OAuth 2.1 bearer
// tokens instead of session cookies, so the instance acts as an authorization
// server for them (see docs/mcp.md). These tables belong to the plugins —
// transcribed from @better-auth/oauth-provider's and the jwt plugin's schema
// definitions, so property names must stay exactly as spelled (the adapter
// looks them up by name). Only written while ENABLE_MCP is set. Re-check them
// against the plugin schema when bumping better-auth.

// Signing keys for the access tokens (the private key is encrypted at rest
// with BETTER_AUTH_SECRET). /api/auth/jwks publishes the public halves.
export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at"),
  alg: text("alg"),
  crv: text("crv"),
});

// Clients register themselves (RFC 7591 dynamic client registration), so a
// row is created by whatever connects, not by an admin.
export const oauthClient = pgTable("oauth_client", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  clientDiscoveryId: text("client_discovery_id"),
  disabled: boolean("disabled").default(false),
  skipConsent: boolean("skip_consent"),
  enableEndSession: boolean("enable_end_session"),
  subjectType: text("subject_type"),
  scopes: text("scopes").array(),
  clientCredentialsScopes: text("client_credentials_scopes").array().default([]),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: text("contacts").array(),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("software_id"),
  softwareVersion: text("software_version"),
  softwareStatement: text("software_statement"),
  redirectUris: text("redirect_uris").array().notNull(),
  postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
  backchannelLogoutUri: text("backchannel_logout_uri"),
  backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  applicationType: text("application_type"),
  jwks: text("jwks"),
  jwksUri: text("jwks_uri"),
  grantTypes: text("grant_types").array(),
  responseTypes: text("response_types").array(),
  requirePKCE: boolean("require_pkce"),
  dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata"),
});

export const oauthResource = pgTable("oauth_resource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
  disabled: boolean("disabled").default(false),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  policyVersion: integer("policy_version").default(1),
  metadata: jsonb("metadata"),
});

export const oauthClientResource = pgTable(
  "oauth_client_resource",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at"),
  },
  (t) => [unique("oauth_client_resource_pair").on(t.clientId, t.resourceId)],
);

// Refresh tokens are what keep a client connected without the user in the
// loop; Settings → AI access deletes them to disconnect a client.
export const oauthRefreshToken = pgTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at"),
    revoked: timestamp("revoked"),
    rotatedAt: timestamp("rotated_at"),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: timestamp("rotation_replay_expires_at"),
    authTime: timestamp("auth_time"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (t) => [
    index("oauth_refresh_token_client_idx").on(t.clientId),
    index("oauth_refresh_token_user_idx").on(t.userId),
    index("oauth_refresh_token_auth_code_idx").on(t.authorizationCodeId),
  ],
);

export const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at"),
    revoked: timestamp("revoked"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (t) => [
    index("oauth_access_token_client_idx").on(t.clientId),
    index("oauth_access_token_user_idx").on(t.userId),
    index("oauth_access_token_refresh_idx").on(t.refreshId),
  ],
);

export const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [
    index("oauth_consent_client_idx").on(t.clientId),
    index("oauth_consent_user_idx").on(t.userId),
  ],
);

// Single-use tracking of private_key_jwt client assertions (the id is the jti).
export const oauthClientAssertion = pgTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
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
    // This location's own content for its label template's slots (the
    // symbol on one bin), by slot name. Validated by parseSlots on write.
    labelSlots: jsonb("label_slots").$type<LabelSlots>().notNull().default({}),
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

// --- Instance settings ---
//
// One row (id = 1, enforced by the CHECK) of preferences that apply to the
// whole instance. Read via src/lib/settings.ts, which falls back to the
// defaults while the row doesn't exist yet.

export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    // Joins labels into a location code: "/" → A/1/IV, "" → A1IV. See
    // validateSeparator in src/lib/location-tree.ts.
    codeSeparator: text("code_separator").notNull().default("/"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [check("app_settings_singleton", sql`${t.id} = 1`)],
);

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
    // Product pages of the suppliers the part can be reordered from, the
    // preferred one first; empty = none. Shown as "Order" links, prominently
    // once stock runs low.
    orderUrls: text("order_urls").array().notNull().default(sql`'{}'::text[]`),
    // A label-icon catalogue id ("screw/hardware/nuts/hex-nut",
    // src/lib/label-icons.json) shown as the thumbnail while the part has no
    // image; "" = none.
    icon: text("icon").notNull().default(""),
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
// when the bin runs empty. A null location is the part's "unsorted" pile —
// stock that is on hand but not put away yet (at most one per part).
export const stock = pgTable(
  "stock",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("stock_part_location").on(t.partId, t.locationId).nullsNotDistinct(),
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
    // move it is the (positive) amount that went from → to. A null location
    // with an empty path is the unsorted pile; a null one with a path is a
    // location deleted since.
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

// Let Settings → AI access show a client's name next to its tokens and
// consents in one query.
export const oauthRefreshTokenRelations = relations(oauthRefreshToken, ({ one }) => ({
  client: one(oauthClient, {
    fields: [oauthRefreshToken.clientId],
    references: [oauthClient.clientId],
  }),
}));

export const oauthConsentRelations = relations(oauthConsent, ({ one }) => ({
  client: one(oauthClient, {
    fields: [oauthConsent.clientId],
    references: [oauthClient.clientId],
  }),
}));
