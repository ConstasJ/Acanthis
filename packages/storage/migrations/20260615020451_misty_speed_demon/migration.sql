ALTER TABLE `cookies` ADD `expires` integer;--> statement-breakpoint
ALTER TABLE `cookies` ADD `max_age` integer;--> statement-breakpoint
ALTER TABLE `cookies` ADD `secure` integer;--> statement-breakpoint
ALTER TABLE `cookies` ADD `http_only` integer;--> statement-breakpoint
ALTER TABLE `cookies` ADD `same_site` text;--> statement-breakpoint
ALTER TABLE `cookies` ADD `created_at` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `cookies` ADD `last_accessed_at` integer NOT NULL;