import type { NovelSearchResult } from "@acanthis-dec/core";
import { and, eq, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { keywordNovels, keywordSearches, novels } from "./table.js";
import type { DataWithUpdatedAt } from "./type.js";

export type MigrationOptions = {
	enabled?: boolean;
	directory?: string;
};

export type DatabaseOptions = {
	path: string;
	migrations?: MigrationOptions;
};

export class DatabaseService {
	private db: ReturnType<typeof drizzle>;
	private isMigrated: boolean = false;
	private migrationOptions: MigrationOptions;

	constructor(options: DatabaseOptions) {
		this.db = drizzle(options.path);
		this.migrationOptions = options.migrations || {
			enabled: true,
			directory: "migrations",
		};
	}

	private _migrate() {
		if (this.isMigrated) return;
		if (!this.db) throw new Error("Database not initialized");
		migrate(this.db, {
			migrationsFolder: this.migrationOptions.directory || "migrations",
		});
		this.isMigrated = true;
	}

	addSearchResult(keyword: string, results: NovelSearchResult[]) {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		this.db.transaction((tx) => {
			tx.insert(keywordSearches)
				.values({
					keyword,
					queryTime: Date.now(),
					total: results.length,
				})
				.onConflictDoUpdate({
					target: keywordSearches.keyword,
					set: {
						queryTime: Date.now(),
						total: results.length,
					},
				})
				.run();

			for (const novel of results) {
				const inserted = tx
					.insert(novels)
					.values({
						platform: novel.platform,
						platformId: novel.id,
						name: novel.title,
						cover: novel.cover ?? "",
						author: "",
						summary: "",
						status: "unknown",
						updateAt: Date.now(),
					})
					.onConflictDoUpdate({
						target: [novels.platform, novels.platformId],
						set: {
							name: novel.title,
							cover: novel.cover ?? "",
							updateAt: Date.now(),
						},
					})
					.returning({ id: novels.id })
					.get();

				const novelId = inserted.id;
				if (novelId) {
					tx.insert(keywordNovels)
						.values({
							novelId,
							keyword,
						})
						.onConflictDoNothing()
						.run();
				}
			}
		});
	}

	searchNovels(keyword: string): DataWithUpdatedAt<NovelSearchResult[]> {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		const minQueryTime = Date.now() - 48 * 60 * 60 * 1000; // 48 hours

		const searchRecord = this.db
			.select()
			.from(keywordSearches)
			.where(
				and(
					eq(keywordSearches.keyword, keyword),
					gte(keywordSearches.queryTime, minQueryTime),
				),
			)
			.get();

		if (!searchRecord) {
			return {
				data: [],
				updatedAt: 0,
			};
		}

		const rows = this.db
			.select({
				platform: novels.platform,
				platformId: novels.platformId,
				title: novels.name,
				cover: novels.cover,
			})
			.from(novels)
			.innerJoin(keywordNovels, eq(novels.id, keywordNovels.novelId))
			.where(eq(keywordNovels.keyword, keyword))
			.all();

		return {
			data: rows.map((row) => ({
				platform: row.platform,
				id: row.platformId,
				title: row.title,
				cover: row.cover,
			})),
			updatedAt: searchRecord.queryTime,
		};
	}
}
