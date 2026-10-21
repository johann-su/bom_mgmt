-- Sibling labels become unique across types, so a location code (A/2/IX)
-- names exactly one location. Fails if two siblings of different types
-- already share a label: relabel one of them, then re-run.

ALTER TABLE "locations" DROP CONSTRAINT "locations_sibling_label";--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_sibling_label" UNIQUE NULLS NOT DISTINCT("parent_id","label");