CREATE TABLE `bookshelf_categories` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`server_updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
ALTER TABLE `bookshelf_items` ADD `category_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookshelf_items` ADD `genres_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookshelf_items` ADD `status` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `reading_progress` ADD `history_hidden_at` integer;