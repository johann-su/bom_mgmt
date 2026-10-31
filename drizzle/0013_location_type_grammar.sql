CREATE TABLE "location_type_children" (
	"parent_type_id" uuid NOT NULL,
	"child_type_id" uuid NOT NULL,
	CONSTRAINT "location_type_children_parent_type_id_child_type_id_pk" PRIMARY KEY("parent_type_id","child_type_id")
);
--> statement-breakpoint
ALTER TABLE "location_types" ADD COLUMN "restrict_children" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "location_type_children" ADD CONSTRAINT "location_type_children_parent_type_id_location_types_id_fk" FOREIGN KEY ("parent_type_id") REFERENCES "public"."location_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_type_children" ADD CONSTRAINT "location_type_children_child_type_id_location_types_id_fk" FOREIGN KEY ("child_type_id") REFERENCES "public"."location_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Without a separator, codes are only readable under a type grammar. Existing
-- separator-free installs get one derived from today's tree: each type may
-- hold exactly the child types it already holds.
INSERT INTO "location_type_children" ("parent_type_id", "child_type_id")
SELECT DISTINCT p."type_id", c."type_id"
FROM "locations" c JOIN "locations" p ON c."parent_id" = p."id"
WHERE EXISTS (SELECT 1 FROM "app_settings" WHERE "code_separator" = '');--> statement-breakpoint
UPDATE "location_types" SET "restrict_children" = true
WHERE EXISTS (SELECT 1 FROM "app_settings" WHERE "code_separator" = '');
