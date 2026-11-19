CREATE TABLE `illustration_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`platform` text NOT NULL,
	`url_hash` text NOT NULL,
	`original_url` text NOT NULL,
	`file_hash` text,
	`content_type` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `illustration_platform_url_hash_idx` ON `illustration_metadata` (`platform`,`url_hash`);
--> statement-breakpoint
DELETE FROM `chapters` WHERE `platform_id` LIKE 'TOBEDETERMINED%';
