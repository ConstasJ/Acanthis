import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Chapter, Novel, NovelSearchResult, Volume } from "@acanthis-dec/core";
import { type Client, createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { z } from "zod";
import {
	chapters,
	generalCache,
	genres,
	keywordNovels,
	keywordSearches,
	novelCoverMetadata,
	novelGenres,
	novels,
	relations,
	volumeCoverMetadata,
	volumes,
} from "./table";
import type {
	DataWithUpdatedAt,
	NovelCoverMetadata,
	VolumeCoverMetadata,
} from "./type";

export type MigrationOptions = {
	enabled?: boolean;
	directory?: string;
};

export type DatabaseOptions = {
	path: string;
	migrations?: MigrationOptions;
};

function getDrizzle(client: Client) {
	return drizzle({
		client,
		relations,
	});
}

export type DrizzleInstance = ReturnType<typeof getDrizzle>;

export class DatabaseService {
	private client: Client;
	db: DrizzleInstance;

	constructor(options: DatabaseOptions) {
		const parentDir = dirname(resolve(options.path));
		if (!existsSync(parentDir)) {
			mkdirSync(parentDir, { recursive: true });
		} else if (existsSync(parentDir) && statSync(parentDir).isFile() === true) {
			rmSync(parentDir);
			mkdirSync(parentDir, { recursive: true });
		}
		this.client = createClient({
			url: `file:${options.path}`,
		});
		this.client.execute("PRAGMA journal_mode = WAL;");
		this.db = getDrizzle(this.client);
		if (options.migrations?.enabled ?? true) {
			this._migrate(options.migrations?.directory);
		}
	}

	private _migrate(directory?: string) {
		if (!this.db) throw new Error("Database not initialized");
		migrate(this.db, {
			migrationsFolder: directory || "migrations",
		});
	}

	async addSearchResult(
		keyword: string,
		platform: string,
		results: NovelSearchResult[],
	) {
		await this.db.transaction(async (tx) => {
			await tx
				.insert(keywordSearches)
				.values({
					keyword,
					platform,
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
				const inserted = await tx
					.insert(novels)
					.values({
						platform: novel.platform,
						platformId: novel.id,
						name: novel.title,
						coverUrl: novel.coverUrl ?? "",
						author: "",
						summary: "",
						status: "unknown",
						updateAt: Date.now(),
					})
					.onConflictDoUpdate({
						target: [novels.platform, novels.platformId],
						set: {
							name: novel.title,
							coverUrl: novel.coverUrl ?? "",
							updateAt: Date.now(),
						},
					})
					.returning({ id: novels.id })
					.get();

				const novelId = inserted.id;
				if (novelId) {
					await tx
						.insert(keywordNovels)
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
		platform: string,
	): Promise<DataWithUpdatedAt<NovelSearchResult[] | undefined>> {
		const minQueryTime = Date.now() - 48 * 60 * 60 * 1000; // 48 hours

		const searchRecord = await this.db.query.keywordSearches
			.findFirst({
				where: {
					keyword,
					platform,
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
							coverUrl: true,
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
					coverUrl: novel.coverUrl,
				})) || undefined,
			updatedAt: searchRecord?.queryTime || 0,
		};
	}

	async addNovelCache(novel: Novel) {
		await this.db.transaction(async (tx) => {
			const { id: novelId } = await tx
				.insert(novels)
				.values({
					platform: novel.platform,
					platformId: novel.id,
					name: novel.title,
					coverUrl: novel.coverUrl ?? "",
					author: novel.author ?? "",
					summary: novel.summary ?? "",
					status: novel.status ?? "unknown",
					updateAt: Date.now(),
				})
				.onConflictDoUpdate({
					target: [novels.platform, novels.platformId],
					set: {
						name: novel.title,
						coverUrl: novel.coverUrl ?? "",
						author: novel.author ?? "",
						summary: novel.summary ?? "",
						status: novel.status ?? "unknown",
						updateAt: Date.now(),
					},
				})
				.returning({ id: novels.id })
				.get();

			for (const genre of novel.genres) {
				const { id: genreId } = await tx
					.insert(genres)
					.values({
						name: genre,
					})
					.onConflictDoUpdate({
						target: genres.name,
						set: {
							name: genre,
						},
					})
					.returning({ id: genres.id })
					.get();
				await tx
					.insert(novelGenres)
					.values({
						novelId,
						genreId,
					})
					.onConflictDoNothing()
					.run();
			}

			for (const volume of novel.volumes) {
				const { id: volumeId } = await tx
					.insert(volumes)
					.values({
						novelId,
						name: volume.title,
						platform: novel.platform,
						platformId: volume.id,
						coverUrl: volume.coverUrl ?? "",
					})
					.onConflictDoUpdate({
						target: [volumes.novelId, volumes.platformId],
						set: {
							name: volume.title,
							coverUrl: volume.coverUrl ?? "",
						},
					})
					.returning({ id: volumes.id })
					.get();
				for (const chapter of volume.chapters) {
					await tx
						.insert(chapters)
						.values({
							novelId,
							volumeId,
							name: chapter.title,
							platform: novel.platform,
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
		const novelRecord = await this.db.query.novels
			.findFirst({
				where: {
					platform,
					platformId,
				},
				with: {
					genres: true,
					volumes: {
						orderBy: {
							id: "asc",
						},
						with: {
							chapters: {
								orderBy: {
									id: "asc",
								},
							},
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
				coverUrl: novelRecord.coverUrl,
				author: novelRecord.author,
				summary: novelRecord.summary,
				status: novelRecord.status,
				genres: novelRecord.genres.map((g) => g.name),
				volumes: novelRecord.volumes.map((v) => ({
					id: v.platformId,
					platform: novelRecord.platform,
					title: v.name,
					coverUrl: v.coverUrl ?? "",
					novelId: novelRecord.platformId,
					chapters: v.chapters.map((c) => ({
						id: c.platformId,
						platform: novelRecord.platform,
						title: c.name,
					})),
				})),
			},
			updatedAt: novelRecord.updateAt,
		};
	}

	async getVolumeMeta(
		platform: string,
		platformId: string,
	): Promise<Volume | undefined> {
		const volumeRecord = await this.db.query.volumes
			.findFirst({
				where: {
					platform,
					platformId,
				},
				with: {
					novel: true,
					chapters: {
						orderBy: {
							id: "asc",
						},
					},
				},
				orderBy: {
					id: "asc",
				}
			})
			.execute();

		if (!volumeRecord) {
			return undefined;
		}

		return {
			id: volumeRecord.platformId,
			platform: volumeRecord.platform,
			title: volumeRecord.name,
			novelId: volumeRecord.novel?.platformId ?? "",
			coverUrl: volumeRecord.coverUrl ?? "",
			chapters: [],
		};
	}

	async getChapterFromTitle(
		title: string,
	): Promise<Partial<Chapter> | undefined> {
		const chapterRecord = await this.db.query.chapters
			.findFirst({
				where: {
					name: title,
				},
			})
			.execute();

		if (!chapterRecord) {
			return undefined;
		}

		return {
			id: chapterRecord.platformId,
			title: chapterRecord.name,
		};
	}

	async getChapterFromId(
		platform: string,
		platformId: string,
	): Promise<Chapter | undefined> {
		const chapterRecord = await this.db.query.chapters
			.findFirst({
				where: {
					platformId,
					novel: {
						platform,
					},
				},
				with: {
					novel: true,
					volume: true,
				},
			})
			.execute();

		if (!chapterRecord) {
			return undefined;
		}

		return {
			id: chapterRecord.platformId,
			platform: chapterRecord.platform,
			title: chapterRecord.name,
			novelId: chapterRecord.novel?.platformId ?? "",
			volumeId: chapterRecord.volume?.platformId ?? "",
			contentHash: chapterRecord.contentHash ?? null,
		};
	}

	async addNovelContentHash(
		platform: string,
		chapterId: string,
		contentHash: string,
	) {
		await this.db
			.update(chapters)
			.set({ contentHash })
			.where(
				and(
					eq(chapters.platformId, chapterId),
					eq(chapters.platform, platform),
				),
			)
			.run();
	}

	async getNovelCoverMetadata(
		platform: string,
		novelId: string,
	): Promise<NovelCoverMetadata | undefined> {
		const queryResult = await this.db.query.novelCoverMetadata
			.findFirst({
				where: {
					novel: {
						platform: platform,
						platformId: novelId,
					},
				},
				with: {
					novel: true,
				},
			})
			.execute();

		if (!queryResult) {
			return undefined;
		}

		return {
			platform: queryResult.novel?.platform ?? null,
			novelId: queryResult.novel?.platformId ?? null,
			hash: queryResult.hash ?? "",
			contentType: queryResult.contentType ?? "",
			originalUrl: queryResult.originalUrl ?? "",
		};
	}

	async addNovelCoverMetadata(metadata: NovelCoverMetadata) {
		const novel =
			metadata.novelId && metadata.platform
				? await this.db.query.novels
						.findFirst({
							where: {
								platform: metadata.platform,
								platformId: metadata.novelId,
							},
						})
						.execute()
				: null;

		await this.db
			.insert(novelCoverMetadata)
			.values({
				hash: metadata.hash,
				contentType: metadata.contentType,
				originalUrl: metadata.originalUrl,
				novelId: novel?.id ?? null,
			})
			.run();
	}

	async getVolumeCoverMetadata(
		platform: string,
		volumeId: string,
	): Promise<VolumeCoverMetadata | undefined> {
		const queryResult = await this.db.query.volumeCoverMetadata
			.findFirst({
				where: {
					volume: {
						platform: platform,
						platformId: volumeId,
					},
				},
				with: {
					volume: {
						with: {
							novel: true,
						},
					},
				},
			})
			.execute();

		if (!queryResult) {
			return undefined;
		}

		return {
			platform: queryResult.volume?.platform ?? null,
			volumeId: queryResult.volume?.platformId ?? null,
			hash: queryResult.hash ?? "",
			contentType: queryResult.contentType ?? "",
			originalUrl: queryResult.originalUrl ?? "",
		};
	}

	async addVolumeCoverMetadata(metadata: VolumeCoverMetadata) {
		const volume =
			metadata.volumeId && metadata.platform
				? await this.db.query.volumes
						.findFirst({
							where: {
								platform: metadata.platform,
								platformId: metadata.volumeId,
							},
						})
						.execute()
				: null;

		await this.db
			.insert(volumeCoverMetadata)
			.values({
				hash: metadata.hash,
				contentType: metadata.contentType,
				originalUrl: metadata.originalUrl,
				volumeId: volume?.id ?? null,
			})
			.run();
	}

	async getCache<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
		const record = await this.db.query.generalCache
			.findFirst({
				where: {
					key,
				},
			})
			.execute();

		if (!record) {
			return null;
		}

		const parsed = schema.safeParse(record.value);
		return parsed.success ? parsed.data : null;
	}

	async setCache<T>(key: string, value: T): Promise<void> {
		await this.db
			.insert(generalCache)
			.values({ key, value })
			.onConflictDoUpdate({
				target: generalCache.key,
				set: { value },
			})
			.run();
	}

	close() {
		this.client.close();
	}
}
