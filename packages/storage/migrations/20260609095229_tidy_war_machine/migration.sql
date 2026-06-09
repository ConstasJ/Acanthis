CREATE TABLE `chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`novel_id` integer NOT NULL,
	`volume_id` integer NOT NULL,
	`platform_id` text NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT `fk_chapters_novel_id_novels_id_fk` FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chapters_volume_id_volumes_id_fk` FOREIGN KEY (`volume_id`) REFERENCES `volumes`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `cookies` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`domain` text NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cover_metadata` (
	`hash` text PRIMARY KEY,
	`content_type` text NOT NULL,
	`original_url` text NOT NULL,
	`ext` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `general_cache` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `genres` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE `keyword_novels` (
	`keyword` text NOT NULL,
	`novel_id` integer NOT NULL,
	CONSTRAINT `keyword_novels_pk` PRIMARY KEY(`keyword`, `novel_id`),
	CONSTRAINT `fk_keyword_novels_keyword_keyword_searches_keyword_fk` FOREIGN KEY (`keyword`) REFERENCES `keyword_searches`(`keyword`) ON DELETE CASCADE,
	CONSTRAINT `fk_keyword_novels_novel_id_novels_id_fk` FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `keyword_searches` (
	`keyword` text PRIMARY KEY,
	`query_time` integer NOT NULL,
	`total` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `novel_genres` (
	`novel_id` integer NOT NULL,
	`genre_id` integer NOT NULL,
	CONSTRAINT `novel_genres_pk` PRIMARY KEY(`novel_id`, `genre_id`),
	CONSTRAINT `fk_novel_genres_novel_id_novels_id_fk` FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_novel_genres_genre_id_genres_id_fk` FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `novels` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`platform` text NOT NULL,
	`platform_id` text NOT NULL,
	`name` text NOT NULL,
	`author` text NOT NULL,
	`summary` text NOT NULL,
	`cover` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `volumes` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`novel_id` integer NOT NULL,
	`name` text NOT NULL,
	`platform_id` text NOT NULL,
	CONSTRAINT `fk_volumes_novel_id_novels_id_fk` FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON DELETE CASCADE
);
