PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`novel_id` integer NOT NULL,
	`volume_id` integer NOT NULL,
	`platform_id` text NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT `fk_chapters_novel_id_novels_id_fk` FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chapters_volume_id_volumes_id_fk` FOREIGN KEY (`volume_id`) REFERENCES `volumes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `novel_and_pid_idx` UNIQUE(`novel_id`,`platform_id`)
);
--> statement-breakpoint
INSERT INTO `__new_chapters`(`id`, `novel_id`, `volume_id`, `platform_id`, `name`) SELECT `id`, `novel_id`, `volume_id`, `platform_id`, `name` FROM `chapters`;--> statement-breakpoint
DROP TABLE `chapters`;--> statement-breakpoint
ALTER TABLE `__new_chapters` RENAME TO `chapters`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cookies` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`domain` text NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `cookie_unique_idx` UNIQUE(`domain`,`path`,`name`)
);
--> statement-breakpoint
INSERT INTO `__new_cookies`(`id`, `domain`, `path`, `name`, `value`) SELECT `id`, `domain`, `path`, `name`, `value` FROM `cookies`;--> statement-breakpoint
DROP TABLE `cookies`;--> statement-breakpoint
ALTER TABLE `__new_cookies` RENAME TO `cookies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_volumes` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`novel_id` integer NOT NULL,
	`name` text NOT NULL,
	`platform_id` text NOT NULL,
	CONSTRAINT `fk_volumes_novel_id_novels_id_fk` FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON DELETE CASCADE,
	CONSTRAINT `novel_and_pid_idx` UNIQUE(`novel_id`,`platform_id`)
);
--> statement-breakpoint
INSERT INTO `__new_volumes`(`id`, `novel_id`, `name`, `platform_id`) SELECT `id`, `novel_id`, `name`, `platform_id` FROM `volumes`;--> statement-breakpoint
DROP TABLE `volumes`;--> statement-breakpoint
ALTER TABLE `__new_volumes` RENAME TO `volumes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cover_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`hash` text NOT NULL UNIQUE,
	`content_type` text NOT NULL,
	`original_url` text NOT NULL,
	`novel_id` integer,
	CONSTRAINT `fk_cover_metadata_novel_id_novels_id_fk` FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_cover_metadata`(`id`, `hash`, `content_type`, `original_url`, `novel_id`) SELECT `id`, `hash`, `content_type`, `original_url`, `novel_id` FROM `cover_metadata`;--> statement-breakpoint
DROP TABLE `cover_metadata`;--> statement-breakpoint
ALTER TABLE `__new_cover_metadata` RENAME TO `cover_metadata`;--> statement-breakpoint
PRAGMA foreign_keys=ON;