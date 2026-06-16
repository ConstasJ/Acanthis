import { defineRelations } from "drizzle-orm";
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
	unique,
} from "drizzle-orm/sqlite-core";

export const novels = sqliteTable(
	"novels",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		platform: text("platform").notNull(),
		platformId: text("platform_id").notNull(),
		name: text("name").notNull(),
		author: text("author").notNull(),
		summary: text("summary").notNull(),
		coverUrl: text("cover_url").notNull(),
		status: text("status", {
			enum: ["ongoing", "completed", "unknown"],
		}).notNull(),
		updateAt: integer("update_at").notNull(),
	},
	(table) => [
		unique("platform_and_pid_idx").on(table.platform, table.platformId),
	],
);

export const genres = sqliteTable("genres", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull().unique(),
});

export const novelGenres = sqliteTable(
	"novel_genres",
	{
		novelId: integer("novel_id")
			.notNull()
			.references(() => novels.id, { onDelete: "cascade" }),
		genreId: integer("genre_id")
			.notNull()
			.references(() => genres.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.novelId, table.genreId] })],
);

export const volumes = sqliteTable(
	"volumes",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		novelId: integer("novel_id")
			.notNull()
			.references(() => novels.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		platform: text("platform").notNull(),
		platformId: text("platform_id").notNull(),
		coverUrl: text("cover_url"),
	},
	(table) => [unique("novel_and_pid_idx").on(table.novelId, table.platformId)],
);

export const chapters = sqliteTable(
	"chapters",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		novelId: integer("novel_id")
			.notNull()
			.references(() => novels.id, { onDelete: "cascade" }),
		volumeId: integer("volume_id")
			.notNull()
			.references(() => volumes.id, { onDelete: "cascade" }),
		platform: text("platform").notNull(),
		platformId: text("platform_id").notNull(),
		contentHash: text("content_hash"),
		name: text("name").notNull(),
	},
	(table) => [unique("novel_and_pid_idx").on(table.novelId, table.platformId)],
);

export const keywordSearches = sqliteTable("keyword_searches", {
	keyword: text("keyword").primaryKey(),
	platform: text("platform").notNull(),
	queryTime: integer("query_time").notNull(),
	total: integer("total").notNull(),
});

export const keywordNovels = sqliteTable(
	"keyword_novels",
	{
		keyword: text("keyword")
			.notNull()
			.references(() => keywordSearches.keyword, { onDelete: "cascade" }),
		novelId: integer("novel_id")
			.notNull()
			.references(() => novels.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.keyword, table.novelId] })],
);

export const novelCoverMetadata = sqliteTable("novel_cover_metadata", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	hash: text("hash").notNull(),
	contentType: text("content_type").notNull(),
	originalUrl: text("original_url").notNull().unique(),
	novelId: integer("novel_id").references(() => novels.id, {
		onDelete: "set null",
	}),
});

export const volumeCoverMetadata = sqliteTable("volume_cover_metadata", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	hash: text("hash").notNull(),
	contentType: text("content_type").notNull(),
	originalUrl: text("original_url").notNull().unique(),
	volumeId: integer("volume_id").references(() => volumes.id, {
		onDelete: "set null",
	}),
});

export const cookies = sqliteTable(
	"cookies",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		domain: text("domain").notNull(),
		path: text("path").notNull(),
		name: text("name").notNull(),
		value: text("value").notNull(),
		expires: integer("expires"),
		maxAge: integer("max_age"),
		secure: integer("secure", { mode: "boolean" }),
		httpOnly: integer("http_only", { mode: "boolean" }),
		sameSite: text("same_site", { enum: ["Strict", "Lax", "None"] }),
		createdAt: integer("created_at").notNull(),
		lastAccessedAt: integer("last_accessed_at").notNull(),
	},
	(table) => [
		unique("cookie_unique_idx").on(table.domain, table.path, table.name),
	],
);

export type CookieRow = typeof cookies.$inferSelect;

export const generalCache = sqliteTable("general_cache", {
	key: text("key").primaryKey(),
	value: text("value", { mode: "json" }).notNull(),
});

export const relations = defineRelations(
	{
		novels,
		genres,
		novelGenres,
		volumes,
		chapters,
		keywordSearches,
		keywordNovels,
		novelCoverMetadata,
		volumeCoverMetadata,
		cookies,
		generalCache,
	},
	(r) => ({
		novels: {
			genres: r.many.genres({
				from: r.novels.id.through(r.novelGenres.novelId),
				to: r.genres.id.through(r.novelGenres.genreId),
			}),
			volumes: r.many.volumes({
				from: r.novels.id,
				to: r.volumes.novelId,
			}),
			cover: r.one.novelCoverMetadata({
				from: r.novels.id,
				to: r.novelCoverMetadata.novelId,
			}),
		},
		genres: {
			novels: r.many.novels(),
		},
		volumes: {
			novel: r.one.novels(),
			chapters: r.many.chapters({
				from: r.volumes.id,
				to: r.chapters.volumeId,
			}),
			cover: r.one.volumeCoverMetadata({
				from: r.volumes.id,
				to: r.volumeCoverMetadata.volumeId,
			}),
		},
		novelCoverMetadata: {
			novel: r.one.novels({
				from: r.novelCoverMetadata.novelId,
				to: r.novels.id,
			}),
		},
		volumeCoverMetadata: {
			volume: r.one.volumes({
				from: r.volumeCoverMetadata.volumeId,
				to: r.volumes.id,
			}),
		},
		chapters: {
			novel: r.one.novels({
				from: r.chapters.novelId,
				to: r.novels.id,
			}),
			volume: r.one.volumes(),
		},
		keywordSearches: {
			novels: r.many.novels({
				from: r.keywordSearches.keyword.through(r.keywordNovels.keyword),
				to: r.novels.id.through(r.keywordNovels.novelId),
			}),
		},
	}),
);
