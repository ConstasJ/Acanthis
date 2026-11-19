import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
	BookshelfItem,
	Chapter,
	Novel,
	NovelInfo,
	NovelSearchResult,
	ReadingProgress,
	Volume,
} from "@acanthis-dec/core";
import { type Client, createClient } from "@libsql/client";
import {
	and,
	count,
	desc,
	eq,
	gt,
	inArray,
	isNull,
	max,
	ne,
	notInArray,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { z } from "zod";
import {
	bookshelfItems,
	chapters,
	generalCache,
	genres,
	illustrationMetadata,
	keywordNovels,
	keywordSearches,
	novelCoverMetadata,
	novelGenres,
	novels,
	readingProgress,
	relations,
	volumeCoverMetadata,
	volumes,
} from "./table";
import type {
	DataWithUpdatedAt,
	ListNovelsOptions,
	MergeSyncStateInput,
	MergeSyncStateResult,
	NovelCoverMetadata,
	PaginatedNovels,
	SyncStateResult,
	VolumeCoverMetadata,
} from "./type";
import { getUrlHash } from "./utils";

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

const CLOCK_SKEW_TOLERANCE_MS = 60_000;

function toBookshelfItem(
	row: typeof bookshelfItems.$inferSelect,
): BookshelfItem {
	return {
		platform: row.platform,
		novelId: row.novelId,
		title: row.title,
		author: row.author,
		coverUrl: row.coverUrl,
		addedAt: row.addedAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
	};
}

function toReadingProgress(
	row: typeof readingProgress.$inferSelect,
): ReadingProgress {
	return {
		platform: row.platform,
		novelId: row.novelId,
		novelTitle: row.novelTitle,
		coverUrl: row.coverUrl,
		volumeId: row.volumeId,
		volumeTitle: row.volumeTitle,
		chapterId: row.chapterId,
		chapterTitle: row.chapterTitle,
		paragraphIndex: row.paragraphIndex,
		totalParagraphs: row.totalParagraphs,
		deviceLabel: row.deviceLabel,
		updatedAt: row.updatedAt,
	};
}

export class DatabaseService {
	private client: Client;
	private readyPromise: Promise<void>;
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
		this.db = getDrizzle(this.client);
		this.readyPromise = this._init(options);
	}

	private async _init(options: DatabaseOptions): Promise<void> {
		await this.client.execute("PRAGMA journal_mode = WAL;");
		if (options.migrations?.enabled ?? true) {
			await this._migrate(options.migrations?.directory);
		}
	}

	private async _migrate(directory?: string): Promise<void> {
		if (!this.db) throw new Error("Database not initialized");
		await migrate(this.db, {
			migrationsFolder: directory || "migrations",
		});
	}

	private async ensureReady(): Promise<void> {
		await this.readyPromise;
	}

	async addSearchResult(
		keyword: string,
		platform: string,
		results: NovelSearchResult[],
	) {
		await this.ensureReady();
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
		await this.ensureReady();
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
		await this.ensureReady();
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

			const volumePlatformIds: string[] = [];
			const chapterPlatformIds: string[] = [];

			for (const volume of novel.volumes) {
				volumePlatformIds.push(volume.id);
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
					chapterPlatformIds.push(chapter.id);
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
								volumeId,
								name: chapter.title,
							},
						})
						.run();
				}
			}

			if (chapterPlatformIds.length > 0) {
				await tx
					.delete(chapters)
					.where(
						and(
							eq(chapters.novelId, novelId),
							notInArray(chapters.platformId, chapterPlatformIds),
						),
					)
					.run();
			} else {
				await tx.delete(chapters).where(eq(chapters.novelId, novelId)).run();
			}

			if (volumePlatformIds.length > 0) {
				await tx
					.delete(volumes)
					.where(
						and(
							eq(volumes.novelId, novelId),
							notInArray(volumes.platformId, volumePlatformIds),
						),
					)
					.run();
			} else {
				await tx.delete(volumes).where(eq(volumes.novelId, novelId)).run();
			}
		});
	}

	async getNovelCache(
		platform: string,
		platformId: string,
	): Promise<DataWithUpdatedAt<Novel | null>> {
		await this.ensureReady();
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
		await this.ensureReady();
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
				},
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
		await this.ensureReady();
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
		await this.ensureReady();
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
		await this.ensureReady();
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
		await this.ensureReady();
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
		await this.ensureReady();
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

		let novelId: number | null = null;
		if (!novel) {
			const result = await this.db
				.insert(novels)
				.values({
					platform: metadata.platform ?? "",
					platformId: metadata.novelId ?? "",
					name: "",
					coverUrl: metadata.originalUrl ?? "",
					author: "",
					summary: "",
					status: "unknown",
					updateAt: Date.now(),
				})
				.onConflictDoNothing()
				.returning({ id: novels.id })
				.get();
			novelId = result?.id ?? null;
		}

		await this.db
			.insert(novelCoverMetadata)
			.values({
				hash: metadata.hash,
				contentType: metadata.contentType,
				originalUrl: metadata.originalUrl,
				novelId: novel?.id ?? novelId ?? null,
			})
			.onConflictDoNothing()
			.run();
	}

	async getVolumeCoverMetadata(
		platform: string,
		volumeId: string,
	): Promise<VolumeCoverMetadata | undefined> {
		await this.ensureReady();
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
		await this.ensureReady();
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
			.onConflictDoNothing()
			.run();
	}

	async getCache<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
		await this.ensureReady();
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
		await this.ensureReady();
		await this.db
			.insert(generalCache)
			.values({ key, value })
			.onConflictDoUpdate({
				target: generalCache.key,
				set: { value },
			})
			.run();
	}

	async registerIllustrations(
		platform: string,
		items: string[] | { urlHash: string; originalUrl: string }[],
	): Promise<void> {
		await this.ensureReady();
		const uniqueItems = new Map<
			string,
			{ urlHash: string; originalUrl: string }
		>();
		for (const item of items) {
			if (typeof item === "string") {
				const trimmed = item.trim();
				if (!trimmed) {
					continue;
				}
				const urlHash = getUrlHash(trimmed);
				if (!uniqueItems.has(urlHash)) {
					uniqueItems.set(urlHash, { urlHash, originalUrl: trimmed });
				}
			} else {
				const urlHash = item.urlHash.trim();
				const originalUrl = item.originalUrl.trim();
				if (!urlHash || !originalUrl) {
					continue;
				}
				if (!uniqueItems.has(urlHash)) {
					uniqueItems.set(urlHash, { urlHash, originalUrl });
				}
			}
		}

		if (uniqueItems.size === 0) {
			return;
		}

		const createdAt = Date.now();
		const rows = Array.from(uniqueItems.values()).map((entry) => ({
			platform,
			urlHash: entry.urlHash,
			originalUrl: entry.originalUrl,
			createdAt,
		}));

		const chunkSize = 200;
		await this.db.transaction(async (tx) => {
			for (let i = 0; i < rows.length; i += chunkSize) {
				const chunk = rows.slice(i, i + chunkSize);
				await tx
					.insert(illustrationMetadata)
					.values(chunk)
					.onConflictDoNothing({
						target: [
							illustrationMetadata.platform,
							illustrationMetadata.urlHash,
						],
					})
					.run();
			}
		});
	}

	async getIllustrationSourceUrl(
		platform: string,
		urlHash: string,
	): Promise<string | undefined> {
		await this.ensureReady();
		const record = await this.db
			.select({ originalUrl: illustrationMetadata.originalUrl })
			.from(illustrationMetadata)
			.where(
				and(
					eq(illustrationMetadata.platform, platform),
					eq(illustrationMetadata.urlHash, urlHash),
				),
			)
			.get();

		return record?.originalUrl;
	}

	async getIllustrationMetadata(
		platform: string,
		urlHash: string,
	): Promise<
		| {
				originalUrl: string;
				fileHash: string | null;
				contentType: string | null;
		  }
		| undefined
	> {
		await this.ensureReady();
		return await this.db
			.select({
				originalUrl: illustrationMetadata.originalUrl,
				fileHash: illustrationMetadata.fileHash,
				contentType: illustrationMetadata.contentType,
			})
			.from(illustrationMetadata)
			.where(
				and(
					eq(illustrationMetadata.platform, platform),
					eq(illustrationMetadata.urlHash, urlHash),
				),
			)
			.get();
	}

	async updateIllustrationFileInfo(
		platform: string,
		urlHash: string,
		fileHash: string,
		contentType: string,
	): Promise<void> {
		await this.ensureReady();
		await this.db
			.update(illustrationMetadata)
			.set({ fileHash, contentType })
			.where(
				and(
					eq(illustrationMetadata.platform, platform),
					eq(illustrationMetadata.urlHash, urlHash),
				),
			)
			.run();
	}

	async listCachedNovels(
		platform: string,
		options: ListNovelsOptions,
	): Promise<PaginatedNovels> {
		await this.ensureReady();
		const page = Math.max(1, Math.trunc(options.page));
		const pageSize = Math.max(1, Math.trunc(options.pageSize));
		const offset = (page - 1) * pageSize;

		const whereClause = and(
			eq(novels.platform, platform),
			ne(novels.status, "unknown"),
			ne(novels.author, ""),
			ne(novels.name, ""),
		);

		const totalResult = await this.db
			.select({ value: count() })
			.from(novels)
			.where(whereClause)
			.get();
		const total = totalResult?.value ?? 0;

		if (total === 0) {
			return {
				items: [],
				total: 0,
				page,
				pageSize,
			};
		}

		const novelRows = await this.db
			.select({
				id: novels.id,
				platform: novels.platform,
				platformId: novels.platformId,
				name: novels.name,
				coverUrl: novels.coverUrl,
				author: novels.author,
				summary: novels.summary,
				status: novels.status,
			})
			.from(novels)
			.where(whereClause)
			.orderBy(desc(novels.updateAt), desc(novels.id))
			.limit(pageSize)
			.offset(offset)
			.all();

		if (novelRows.length === 0) {
			return {
				items: [],
				total,
				page,
				pageSize,
			};
		}

		const novelIds = novelRows.map((row) => row.id);
		const genreRows = await this.db
			.select({
				novelId: novelGenres.novelId,
				genreName: genres.name,
			})
			.from(novelGenres)
			.innerJoin(genres, eq(novelGenres.genreId, genres.id))
			.where(inArray(novelGenres.novelId, novelIds))
			.all();

		const genresByNovelId = new Map<number, string[]>();
		for (const row of genreRows) {
			const existing = genresByNovelId.get(row.novelId);
			if (existing) {
				existing.push(row.genreName);
			} else {
				genresByNovelId.set(row.novelId, [row.genreName]);
			}
		}

		const items: NovelInfo[] = novelRows.map((row) => ({
			id: row.platformId,
			platform: row.platform,
			title: row.name,
			coverUrl: row.coverUrl,
			author: row.author,
			summary: row.summary,
			status: row.status,
			genres: genresByNovelId.get(row.id) ?? [],
		}));

		return {
			items,
			total,
			page,
			pageSize,
		};
	}

	private async getMaxSyncCursor(
		executor: Pick<DrizzleInstance, "select">,
	): Promise<number> {
		const bookshelfMaxRow = await executor
			.select({ value: max(bookshelfItems.serverUpdatedAt) })
			.from(bookshelfItems)
			.get();
		const progressMaxRow = await executor
			.select({ value: max(readingProgress.serverUpdatedAt) })
			.from(readingProgress)
			.get();
		const bookshelfMax = Number(bookshelfMaxRow?.value ?? 0);
		const progressMax = Number(progressMaxRow?.value ?? 0);
		return Math.max(bookshelfMax, progressMax);
	}

	async getSyncState(since?: number): Promise<SyncStateResult> {
		await this.ensureReady();
		return await this.db.transaction(async (tx) => {
			const maxCursor = await this.getMaxSyncCursor(tx);

			if (since === undefined || since <= 0) {
				const bookshelfRows = await tx
					.select()
					.from(bookshelfItems)
					.where(isNull(bookshelfItems.deletedAt))
					.all();
				const progressRows = await tx.select().from(readingProgress).all();

				return {
					bookshelf: bookshelfRows.map(toBookshelfItem),
					progress: progressRows.map(toReadingProgress),
					cursor: maxCursor,
				};
			}

			const bookshelfRows = await tx
				.select()
				.from(bookshelfItems)
				.where(gt(bookshelfItems.serverUpdatedAt, since))
				.all();
			const progressRows = await tx
				.select()
				.from(readingProgress)
				.where(gt(readingProgress.serverUpdatedAt, since))
				.all();

			return {
				bookshelf: bookshelfRows.map(toBookshelfItem),
				progress: progressRows.map(toReadingProgress),
				cursor: Math.max(since, maxCursor),
			};
		});
	}

	async mergeSyncState(
		input: MergeSyncStateInput,
	): Promise<MergeSyncStateResult> {
		await this.ensureReady();
		return await this.db.transaction(async (tx) => {
			let lastCursor = await this.getMaxSyncCursor(tx);
			const nextCursor = () => {
				lastCursor = Math.max(Date.now(), lastCursor + 1);
				return lastCursor;
			};

			const bookshelfMap = new Map<string, BookshelfItem>();
			const progressMap = new Map<string, ReadingProgress>();

			for (const item of input.bookshelf ?? []) {
				const key = `${item.platform}\0${item.novelId}`;
				const effectiveUpdatedAt = Math.min(
					item.updatedAt,
					Date.now() + CLOCK_SKEW_TOLERANCE_MS,
				);
				const existing = await tx
					.select()
					.from(bookshelfItems)
					.where(
						and(
							eq(bookshelfItems.platform, item.platform),
							eq(bookshelfItems.novelId, item.novelId),
						),
					)
					.get();

				if (!existing) {
					const serverUpdatedAt = nextCursor();
					const inserted = await tx
						.insert(bookshelfItems)
						.values({
							platform: item.platform,
							novelId: item.novelId,
							title: item.title,
							author: item.author,
							coverUrl: item.coverUrl,
							addedAt: item.addedAt,
							updatedAt: effectiveUpdatedAt,
							serverUpdatedAt,
							deletedAt: item.deletedAt,
						})
						.returning()
						.get();
					bookshelfMap.set(key, toBookshelfItem(inserted));
				} else if (effectiveUpdatedAt >= existing.updatedAt) {
					const serverUpdatedAt = nextCursor();
					const updated = await tx
						.update(bookshelfItems)
						.set({
							title: item.title,
							author: item.author,
							coverUrl: item.coverUrl,
							addedAt: item.addedAt,
							updatedAt: effectiveUpdatedAt,
							serverUpdatedAt,
							deletedAt: item.deletedAt,
						})
						.where(eq(bookshelfItems.id, existing.id))
						.returning()
						.get();
					if (!updated) {
						throw new Error(
							`Failed to update bookshelf item: ${item.platform}/${item.novelId}`,
						);
					}
					bookshelfMap.set(key, toBookshelfItem(updated));
				} else {
					bookshelfMap.set(key, toBookshelfItem(existing));
				}
			}

			for (const item of input.progress ?? []) {
				const key = `${item.platform}\0${item.novelId}`;
				const effectiveUpdatedAt = Math.min(
					item.updatedAt,
					Date.now() + CLOCK_SKEW_TOLERANCE_MS,
				);
				const existing = await tx
					.select()
					.from(readingProgress)
					.where(
						and(
							eq(readingProgress.platform, item.platform),
							eq(readingProgress.novelId, item.novelId),
						),
					)
					.get();

				if (!existing) {
					const serverUpdatedAt = nextCursor();
					const inserted = await tx
						.insert(readingProgress)
						.values({
							platform: item.platform,
							novelId: item.novelId,
							novelTitle: item.novelTitle,
							coverUrl: item.coverUrl,
							volumeId: item.volumeId,
							volumeTitle: item.volumeTitle,
							chapterId: item.chapterId,
							chapterTitle: item.chapterTitle,
							paragraphIndex: item.paragraphIndex,
							totalParagraphs: item.totalParagraphs,
							deviceLabel: item.deviceLabel,
							updatedAt: effectiveUpdatedAt,
							serverUpdatedAt,
						})
						.returning()
						.get();
					progressMap.set(key, toReadingProgress(inserted));
				} else if (effectiveUpdatedAt >= existing.updatedAt) {
					const serverUpdatedAt = nextCursor();
					const updated = await tx
						.update(readingProgress)
						.set({
							novelTitle: item.novelTitle,
							coverUrl: item.coverUrl,
							volumeId: item.volumeId,
							volumeTitle: item.volumeTitle,
							chapterId: item.chapterId,
							chapterTitle: item.chapterTitle,
							paragraphIndex: item.paragraphIndex,
							totalParagraphs: item.totalParagraphs,
							deviceLabel: item.deviceLabel,
							updatedAt: effectiveUpdatedAt,
							serverUpdatedAt,
						})
						.where(eq(readingProgress.id, existing.id))
						.returning()
						.get();
					if (!updated) {
						throw new Error(
							`Failed to update reading progress: ${item.platform}/${item.novelId}`,
						);
					}
					progressMap.set(key, toReadingProgress(updated));
				} else {
					progressMap.set(key, toReadingProgress(existing));
				}
			}

			const serverTime = Math.max(Date.now(), lastCursor);
			return {
				bookshelf: Array.from(bookshelfMap.values()),
				progress: Array.from(progressMap.values()),
				serverTime,
			};
		});
	}

	async close(logger?: (message: string) => void) {
		try {
			await this.ensureReady().catch(() => {});
			await this.client.execute("PRAGMA journal_mode = DELETE;");
			logger?.("WAL写入盘完成，正在关闭数据库连接...");
		} catch (error) {
			logger?.(`执行WAL检查点时发生错误: ${error}`);
		} finally {
			this.client.close();
			logger?.("数据库连接已关闭");
		}
	}
}
