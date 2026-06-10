import type { Novel, NovelSearchResult } from "@acanthis-dec/core";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
	type Cookie,
	type CoverMetadata,
	chapters,
	cookies,
	coverMetadata,
	generalCache,
	genres,
	keywordNovels,
	keywordSearches,
	novelGenres,
	novels,
	relations,
	volumes,
} from "./table.js";
import type { DataWithUpdatedAt } from "./type.js";

export type MigrationOptions = {
	enabled?: boolean;
	directory?: string;
};

export type DatabaseOptions = {
	path: string;
	migrations?: MigrationOptions;
};

function getDrizzle(path: string) {
	return drizzle({
		connection: path,
		relations,
	});
}

export class DatabaseService {
	private db: ReturnType<typeof getDrizzle>;
	private isMigrated: boolean = false;
	private migrationOptions: MigrationOptions;

	constructor(options: DatabaseOptions) {
		this.db = getDrizzle(options.path);
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

	async searchNovels(
		keyword: string,
	): Promise<DataWithUpdatedAt<NovelSearchResult[]>> {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		const minQueryTime = Date.now() - 48 * 60 * 60 * 1000; // 48 hours

		const searchRecord = await this.db.query.keywordSearches
			.findFirst({
				where: {
					keyword: keyword,
					queryTime: {
						gte: minQueryTime,
					},
				},
				with: {
					novels: {
						columns: {
							platform: true,
							platformId: true,
							name: true,
							cover: true,
						},
					},
				},
			})
			.execute();

		return {
			data:
				searchRecord?.novels.map((novel) => ({
					platform: novel.platform,
					id: novel.platformId,
					title: novel.name,
					cover: novel.cover,
				})) || [],
			updatedAt: searchRecord?.queryTime || 0,
		};
	}

	addNovelCache(novel: Novel) {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		this.db.transaction((tx) => {
			const { id: novelId } = tx
				.insert(novels)
				.values({
					platform: novel.platform,
					platformId: novel.id,
					name: novel.title,
					cover: novel.cover ?? "",
					author: novel.author ?? "",
					summary: novel.summary ?? "",
					status: novel.status ?? "unknown",
					updateAt: Date.now(),
				})
				.onConflictDoUpdate({
					target: [novels.platform, novels.platformId],
					set: {
						name: novel.title,
						cover: novel.cover ?? "",
						author: novel.author ?? "",
						summary: novel.summary ?? "",
						status: novel.status ?? "unknown",
						updateAt: Date.now(),
					},
				})
				.returning({ id: novels.id })
				.get();

			for (const genre of novel.genres) {
				const { id: genreId } = tx
					.insert(genres)
					.values({
						name: genre,
					})
					.onConflictDoNothing()
					.returning({ id: genres.id })
					.get();
				tx.insert(novelGenres)
					.values({
						novelId,
						genreId,
					})
					.onConflictDoNothing()
					.run();
			}

			for (const volume of novel.volumes) {
				const { id: volumeId } = tx
					.insert(volumes)
					.values({
						novelId,
						name: volume.title,
						platformId: volume.id,
					})
					.onConflictDoUpdate({
						target: [volumes.novelId, volumes.platformId],
						set: {
							name: volume.title,
						},
					})
					.returning({ id: volumes.id })
					.get();
				for (const chapter of volume.chapters) {
					tx.insert(chapters)
						.values({
							novelId,
							volumeId,
							name: chapter.title,
							platformId: chapter.id,
						})
						.onConflictDoUpdate({
							target: [chapters.novelId, chapters.platformId],
							set: {
								name: chapter.title,
							},
						})
						.run();
				}
			}
		});
	}

	async getNovelCache(
		platform: string,
		platformId: string,
	): Promise<DataWithUpdatedAt<Novel | null>> {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		const novelRecord = await this.db.query.novels
			.findFirst({
				where: {
					platform,
					platformId,
				},
				with: {
					genres: true,
					volumes: {
						with: {
							chapters: true,
						},
					},
				},
			})
			.execute();

		if (!novelRecord) {
			return {
				data: null,
				updatedAt: 0,
			};
		}

		return {
			data: {
				platform: novelRecord.platform,
				id: novelRecord.platformId,
				title: novelRecord.name,
				cover: novelRecord.cover,
				author: novelRecord.author,
				summary: novelRecord.summary,
				status: novelRecord.status,
				genres: novelRecord.genres.map((g) => g.name),
				volumes: novelRecord.volumes.map((v) => ({
					id: v.platformId,
					title: v.name,
					chapters: v.chapters.map((c) => ({
						id: c.platformId,
						title: c.name,
					})),
				})),
			},
			updatedAt: novelRecord.updateAt,
		};
	}

	async getCoverMetadata(hash: string): Promise<CoverMetadata | undefined> {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		return await this.db.query.coverMetadata
			.findFirst({
				where: {
					hash,
				},
			})
			.execute();
	}

	async addCoverMetadata(metadata: CoverMetadata) {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		this.db
			.insert(coverMetadata)
			.values(metadata)
			.onConflictDoUpdate({
				target: coverMetadata.hash,
				set: {
					contentType: metadata.contentType,
					originalUrl: metadata.originalUrl,
					ext: metadata.ext,
				},
			})
			.run();
	}

	async getCookies(domain: string, path: string): Promise<Cookie[]> {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		return await this.db.query.cookies
			.findMany({
				where: {
					domain,
					path,
				},
			})
			.execute();
	}

	async setCookies(
		domain: string,
		path: string,
		cookieList: Omit<Cookie, "id">[],
	): Promise<void> {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		await this.db
			.delete(cookies)
			.where(and(eq(cookies.domain, domain), eq(cookies.path, path)))
			.run();

		if (cookieList.length > 0) {
			const insertData = cookieList.map((cookie) => ({
				domain,
				path,
				name: cookie.name,
				value: cookie.value,
			}));
			await this.db.insert(cookies).values(insertData).run();
		}
	}

	async getCookie(
		domain: string,
		path: string,
		name: string,
	): Promise<Cookie | undefined> {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		return await this.db.query.cookies
			.findFirst({
				where: {
					domain,
					path,
					name,
				},
			})
			.execute();
	}

	async addCookie(cookie: Omit<Cookie, "id">) {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		this.db
			.insert(cookies)
			.values(cookie)
			.onConflictDoUpdate({
				target: [cookies.domain, cookies.path, cookies.name],
				set: {
					value: cookie.value,
				},
			})
			.run();
	}

	async getCache(key: string): Promise<string | null> {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		const record = await this.db.query.generalCache
			.findFirst({
				where: {
					key,
				},
			})
			.execute();

		return record ? record.value : null;
	}

	async setCache(key: string, value: string) {
		if (this.migrationOptions.enabled) {
			this._migrate();
		}

		this.db
			.insert(generalCache)
			.values({ key, value })
			.onConflictDoUpdate({
				target: generalCache.key,
				set: { value },
			})
			.run();
	}
}
