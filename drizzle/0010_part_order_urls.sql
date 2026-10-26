-- A part can have several supplier links; the single order link becomes the first.
ALTER TABLE "parts" ADD COLUMN "order_urls" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
UPDATE "parts" SET "order_urls" = ARRAY["order_url"] WHERE "order_url" <> '';--> statement-breakpoint
ALTER TABLE "parts" DROP COLUMN "order_url";