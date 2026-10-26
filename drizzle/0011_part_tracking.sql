-- How a part's stock is kept: exact counts (as before), levels, in/out, or not at all.
ALTER TABLE "parts" ADD COLUMN "tracking" text DEFAULT 'exact' NOT NULL;