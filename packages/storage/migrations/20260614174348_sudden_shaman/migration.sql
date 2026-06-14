PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_novels` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`platform` text NOT NULL,
	`platform_id` text NOT NULL,
	`name` text NOT NULL,
	`author` text NOT NULL,
	`summary` text NOT NULL,
	`cover_url` text NOT NULL,
	`status` text NOT NULL,
	`update_at` integer NOT NULL,
	CONSTRAINT `platform_and_pid_idx` UNIQUE(`platform`,`platform_id`)
);
--> statement-breakpoint
INSERT INTO `__new_novels`(`id`, `platform`, `platform_id`, `name`, `author`, `summary`, `cover_url`, `status`, `update_at`) SELECT `id`, `platform`, `platform_id`, `name`, `author`, `summary`, `cover_url`, `status`, `update_at` FROM `novels`;--> statement-breakpoint
DROP TABLE `novels`;--> statement-breakpoint
ALTER TABLE `__new_novels` RENAME TO `novels`;--> statement-breakpoint
PRAGMA foreign_keys=ON;