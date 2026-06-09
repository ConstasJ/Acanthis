import { defineRelations } from "drizzle-orm";
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

export const novels = sqliteTable("novels", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	platform: text("platform").notNull(),
	platformId: text("platform_id").notNull(),
	name: text("name").notNull(),
	author: text("author").notNull(),
	summary: text("summary").notNull(),
	cover: text("cover").notNull(),
	status: text("status", {
		enum: ["ongoing", "completed", "unknown"],
	}).notNull(),
});

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

export const volumes = sqliteTable("volumes", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    novelId: integer("novel_id")
        .notNull()
        .references(() => novels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platformId: text("platform_id").notNull(),
});

export const chapters = sqliteTable("chapters", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    novelId: integer("novel_id")
        .notNull()
        .references(() => novels.id, { onDelete: "cascade" }),
    volumeId: integer("volume_id")
        .notNull()
        .references(() => volumes.id, { onDelete: "cascade" }),
    platformId: text("platform_id").notNull(),
    name: text("name").notNull(),
});

export const keywordSearchves = sqliteTable("keyword_searches", {
    keyword: text("keyword").primaryKey(),
    queryTime: integer("query_time").notNull(),
    total: integer("total").notNull(),
});

export const keywordNovels = sqliteTable(
    "keyword_novels",
    {
        keyword: text("keyword")
            .notNull()
            .references(() => keywordSearchves.keyword, { onDelete: "cascade" }),
        novelId: integer("novel_id")
            .notNull()
            .references(() => novels.id, { onDelete: "cascade" }),
    },
    (table) => [primaryKey({ columns: [table.keyword, table.novelId] })],
);

export const coverMetadata = sqliteTable("cover_metadata", {
    hash: text("hash").primaryKey(),
    contentType: text("content_type").notNull(),
    originalUrl: text("original_url").notNull(),
    ext: text("ext").notNull(),
});

export const cookies = sqliteTable("cookies", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    domain: text("domain").notNull(),
    path: text("path").notNull(),
    name: text("name").notNull(),
    value: text("value").notNull(),
});

export const generalCache = sqliteTable("general_cache", {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
});

export const relations = defineRelations({ novels, genres, novelGenres, volumes, chapters, keywordSearchves, keywordNovels }, 
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
        },
        chapters: {
            novel: r.one.novels({
                from: r.chapters.novelId,
                to: r.novels.id,
            }),
            volume: r.one.volumes(),
        },
        keywordSearchves: {
            novels: r.many.novels({
                from: r.keywordSearchves.keyword.through(r.keywordNovels.keyword),
                to: r.novels.id.through(r.keywordNovels.novelId),
            }),
        }
    })
)