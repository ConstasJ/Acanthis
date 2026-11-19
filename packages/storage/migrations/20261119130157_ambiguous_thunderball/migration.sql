CREATE TABLE `bookshelf_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`platform` text NOT NULL,
	`novel_id` text NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`cover_url` text NOT NULL,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`server_updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `reading_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`platform` text NOT NULL,
	`novel_id` text NOT NULL,
	`novel_title` text NOT NULL,
	`cover_url` text NOT NULL,
	`volume_id` text NOT NULL,
	`volume_title` text NOT NULL,
	`chapter_id` text NOT NULL,
	`chapter_title` text NOT NULL,
	`paragraph_index` integer NOT NULL,
	`total_paragraphs` integer NOT NULL,
	`device_label` text NOT NULL,
	`updated_at` integer NOT NULL,
	`server_updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookshelf_platform_novel_idx` ON `bookshelf_items` (`platform`,`novel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reading_progress_platform_novel_idx` ON `reading_progress` (`platform`,`novel_id`);