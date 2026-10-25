CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"code_separator" text DEFAULT '/' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_singleton" CHECK ("app_settings"."id" = 1)
);
