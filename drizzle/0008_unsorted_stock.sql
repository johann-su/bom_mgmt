-- Stock may sit unsorted: a null location_id is a part's "not put away yet"
-- pile. NULLS NOT DISTINCT keeps it to one such row per part.

ALTER TABLE "stock" DROP CONSTRAINT "stock_part_location";--> statement-breakpoint
ALTER TABLE "stock" ALTER COLUMN "location_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock" ADD CONSTRAINT "stock_part_location" UNIQUE NULLS NOT DISTINCT("part_id","location_id");