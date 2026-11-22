import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
	BookshelfCategory,
	BookshelfItem,
	CachedGenreItem,
	Chapter,
	DeviceKind,
	Novel,
	NovelInfo,
	NovelSearchResult,
	NovelStatus,
	ReadingProgress,
	Volume,
} from "@acanthis-dec/core";
import { type Client, createClient } from "@libsql/client";
import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
	inArray,
	isNull,
	max,
	ne,
	notInArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { z } from "zod";
import {
	bookshelfCategories,
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

function normalizeStringList(values: readonly string[] | undefined): string[] {
	if (!values || values.length === 0) {
		return [];
	}
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of values) {
		const trimmed = raw.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

function parseJsonStringArray(raw: string | null | undefined): string[] {
	if (!raw) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return normalizeStringList(
			parsed.filter((entry): entry is string => typeof entry === "string"),
		);
	} catch {
		return [];
	}
}

function escapeLikePattern(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("%", "\\%")
		.replaceAll("_", "\\_");
}

function toBookshelfCategory(
	row: typeof bookshelfCategories.$inferSelect,
): BookshelfCategory {
	return {
		id: row.id,
		name: row.name,
		sortOrder: row.sortOrder,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
	};
}

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
		categoryIds: parseJsonStringArray(row.categoryIds),
		genres: parseJsonStringArray(row.genresJson),
		status: row.status,
	};
}

function normalizeDeviceKind(value: unknown): DeviceKind {
	if (value === "desktop" || value === "mobile") {
		return value;
	}
	return "unknown";
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
		deviceKind: normalizeDeviceKind(row.deviceKind),
		updatedAt: row.updatedAt,
		historyHiddenAt: row.historyHiddenAt ?? null,
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

		const conditions: SQL[] = [
			eq(novels.platform, platform),
			ne(novels.author, ""),
			ne(novels.name, ""),
		];

		if (options.status !== undefined) {
			conditions.push(eq(novels.status, options.status));
		} else {
			conditions.push(ne(novels.status, "unknown"));
		}

		const trimmedQuery = options.q?.trim();
		if (trimmedQuery) {
			const escaped = escapeLikePattern(trimmedQuery.toLowerCase());
			const pattern = `%${escaped}%`;
			const keywordCondition = or(
				sql`LOWER(${novels.name}) LIKE ${pattern} ESCAPE '\\'`,
				sql`LOWER(${novels.author}) LIKE ${pattern} ESCAPE '\\'`,
			);
			if (keywordCondition) {
				conditions.push(keywordCondition);
			}
		}

		const normalizedGenres = normalizeStringList(options.genres);
		if (normalizedGenres.length > 0) {
			const matchingNovelIdsSubquery = this.db
				.select({ novelId: novelGenres.novelId })
				.from(novelGenres)
				.innerJoin(genres, eq(novelGenres.genreId, genres.id))
				.where(inArray(genres.name, normalizedGenres))
				.groupBy(novelGenres.novelId)
				.having(
					sql`COUNT(DISTINCT ${genres.name}) = ${normalizedGenres.length}`,
				);
			conditions.push(inArray(novels.id, matchingNovelIdsSubquery));
		}

		const whereClause = and(...conditions);

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

	async listCachedGenres(platform: string): Promise<CachedGenreItem[]> {
		await this.ensureReady();
		const countExpr = sql<number>`COUNT(DISTINCT ${novels.id})`;
		const rows = await this.db
			.select({
				name: genres.name,
				count: countExpr,
			})
			.from(novelGenres)
			.innerJoin(genres, eq(novelGenres.genreId, genres.id))
			.innerJoin(novels, eq(novelGenres.novelId, novels.id))
			.where(
				and(
					eq(novels.platform, platform),
					ne(novels.status, "unknown"),
					ne(novels.author, ""),
					ne(novels.name, ""),
				),
			)
			.groupBy(genres.id, genres.name)
			.orderBy(desc(countExpr), asc(genres.name))
			.all();

		return rows.map((row) => ({
			name: row.name,
			count: Number(row.count),
		}));
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
		const categoryMaxRow = await executor
			.select({ value: max(bookshelfCategories.serverUpdatedAt) })
			.from(bookshelfCategories)
			.get();
		const bookshelfMax = Number(bookshelfMaxRow?.value ?? 0);
		const progressMax = Number(progressMaxRow?.value ?? 0);
		const categoryMax = Number(categoryMaxRow?.value ?? 0);
		return Math.max(bookshelfMax, progressMax, categoryMax);
	}

	private async enrichBookshelfItemsWithNovelMetadata(
		executor: Pick<DrizzleInstance, "select">,
		items: BookshelfItem[],
	): Promise<BookshelfItem[]> {
		if (items.length === 0) {
			return items;
		}

		const idsByPlatform = new Map<string, Set<string>>();
		for (const item of items) {
			let idSet = idsByPlatform.get(item.platform);
			if (!idSet) {
				idSet = new Set<string>();
				idsByPlatform.set(item.platform, idSet);
			}
			idSet.add(item.novelId);
		}

		const matchedNovels: {
			id: number;
			platform: string;
			platformId: string;
			status: NovelStatus;
		}[] = [];

		const chunkSize = 500;
		for (const [platform, idSet] of idsByPlatform) {
			const allIds = Array.from(idSet);
			for (let i = 0; i < allIds.length; i += chunkSize) {
				const chunk = allIds.slice(i, i + chunkSize);
				const rows = await executor
					.select({
						id: novels.id,
						platform: novels.platform,
						platformId: novels.platformId,
						status: novels.status,
					})
					.from(novels)
					.where(
						and(
							eq(novels.platform, platform),
							inArray(novels.platformId, chunk),
						),
					)
					.all();
				matchedNovels.push(...rows);
			}
		}

		const genresByNovelDbId = new Map<number, string[]>();
		if (matchedNovels.length > 0) {
			const dbIds = matchedNovels.map((row) => row.id);
			for (let i = 0; i < dbIds.length; i += chunkSize) {
				const chunk = dbIds.slice(i, i + chunkSize);
				const genreRows = await executor
					.select({
						novelId: novelGenres.novelId,
						genreName: genres.name,
					})
					.from(novelGenres)
					.innerJoin(genres, eq(novelGenres.genreId, genres.id))
					.where(inArray(novelGenres.novelId, chunk))
					.all();
				for (const row of genreRows) {
					const list = genresByNovelDbId.get(row.novelId);
					if (list) {
						list.push(row.genreName);
					} else {
						genresByNovelDbId.set(row.novelId, [row.genreName]);
					}
				}
			}
		}

		const metaByKey = new Map<
			string,
			{ status: NovelStatus; genres: string[] }
		>();
		for (const novelRow of matchedNovels) {
			const key = `${novelRow.platform}\0${novelRow.platformId}`;
			metaByKey.set(key, {
				status: novelRow.status,
				genres: normalizeStringList(genresByNovelDbId.get(novelRow.id)),
			});
		}

		return items.map((item) => {
			const key = `${item.platform}\0${item.novelId}`;
			const novelMeta = metaByKey.get(key);
			const fallbackGenres = normalizeStringList(item.genres);
			const fallbackStatus: NovelStatus = item.status ?? "unknown";
			const resolvedGenres =
				novelMeta && novelMeta.genres.length > 0
					? novelMeta.genres
					: fallbackGenres;
			const resolvedStatus: NovelStatus =
				novelMeta && novelMeta.status !== "unknown"
					? novelMeta.status
					: fallbackStatus;

			return {
				...item,
				categoryIds: normalizeStringList(item.categoryIds),
				genres: resolvedGenres,
				status: resolvedStatus,
			};
		});
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
				const categoryRows = await tx
					.select()
					.from(bookshelfCategories)
					.where(isNull(bookshelfCategories.deletedAt))
					.orderBy(
						asc(bookshelfCategories.sortOrder),
						asc(bookshelfCategories.createdAt),
						asc(bookshelfCategories.id),
					)
					.all();

				const enrichedBookshelf =
					await this.enrichBookshelfItemsWithNovelMetadata(
						tx,
						bookshelfRows.map(toBookshelfItem),
					);

				return {
					bookshelf: enrichedBookshelf,
					progress: progressRows.map(toReadingProgress),
					categories: categoryRows.map(toBookshelfCategory),
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
			const categoryRows = await tx
				.select()
				.from(bookshelfCategories)
				.where(gt(bookshelfCategories.serverUpdatedAt, since))
				.orderBy(
					asc(bookshelfCategories.sortOrder),
					asc(bookshelfCategories.createdAt),
					asc(bookshelfCategories.id),
				)
				.all();

			const enrichedBookshelf =
				await this.enrichBookshelfItemsWithNovelMetadata(
					tx,
					bookshelfRows.map(toBookshelfItem),
				);

			return {
				bookshelf: enrichedBookshelf,
				progress: progressRows.map(toReadingProgress),
				categories: categoryRows.map(toBookshelfCategory),
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

			const categoryMap = new Map<string, BookshelfCategory>();
			const bookshelfMap = new Map<string, BookshelfItem>();
			const progressMap = new Map<string, ReadingProgress>();

			for (const cat of input.categories ?? []) {
				const maxAllowedTime = Date.now() + CLOCK_SKEW_TOLERANCE_MS;
				const effectiveUpdatedAt = Math.min(cat.updatedAt, maxAllowedTime);
				const effectiveCreatedAt = Math.min(cat.createdAt, maxAllowedTime);
				const trimmedName = cat.name.trim();
				const normalizedSortOrder = Math.trunc(cat.sortOrder);

				const existing = await tx
					.select()
					.from(bookshelfCategories)
					.where(eq(bookshelfCategories.id, cat.id))
					.get();

				if (!existing) {
					const serverUpdatedAt = nextCursor();
					const inserted = await tx
						.insert(bookshelfCategories)
						.values({
							id: cat.id,
							name: trimmedName,
							sortOrder: normalizedSortOrder,
							createdAt: effectiveCreatedAt,
							updatedAt: effectiveUpdatedAt,
							serverUpdatedAt,
							deletedAt: cat.deletedAt,
						})
						.returning()
						.get();
					categoryMap.set(cat.id, toBookshelfCategory(inserted));
				} else if (effectiveUpdatedAt >= existing.updatedAt) {
					const serverUpdatedAt = nextCursor();
					const updated = await tx
						.update(bookshelfCategories)
						.set({
							name: trimmedName,
							sortOrder: normalizedSortOrder,
							updatedAt: effectiveUpdatedAt,
							serverUpdatedAt,
							deletedAt: cat.deletedAt,
						})
						.where(eq(bookshelfCategories.id, existing.id))
						.returning()
						.get();
					if (!updated) {
						throw new Error(`Failed to update bookshelf category: ${cat.id}`);
					}
					categoryMap.set(cat.id, toBookshelfCategory(updated));
				} else {
					categoryMap.set(cat.id, toBookshelfCategory(existing));
				}
			}

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
							categoryIds: JSON.stringify(
								normalizeStringList(item.categoryIds),
							),
							genresJson: JSON.stringify(normalizeStringList(item.genres)),
							status: item.status ?? "unknown",
						})
						.returning()
						.get();
					bookshelfMap.set(key, toBookshelfItem(inserted));
				} else if (effectiveUpdatedAt >= existing.updatedAt) {
					const serverUpdatedAt = nextCursor();
					const nextCategoryIds =
						item.categoryIds !== undefined
							? JSON.stringify(normalizeStringList(item.categoryIds))
							: existing.categoryIds;
					const nextGenresJson =
						item.genres !== undefined
							? JSON.stringify(normalizeStringList(item.genres))
							: existing.genresJson;
					const nextStatus =
						item.status !== undefined ? item.status : existing.status;

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
							categoryIds: nextCategoryIds,
							genresJson: nextGenresJson,
							status: nextStatus,
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
				const maxAllowedTime = Date.now() + CLOCK_SKEW_TOLERANCE_MS;
				const effectiveUpdatedAt = Math.min(item.updatedAt, maxAllowedTime);
				const incomingHiddenAt =
					typeof item.historyHiddenAt === "number"
						? Math.min(item.historyHiddenAt, maxAllowedTime)
						: null;

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
							deviceKind: normalizeDeviceKind(item.deviceKind),
							updatedAt: effectiveUpdatedAt,
							serverUpdatedAt,
							historyHiddenAt: incomingHiddenAt,
						})
						.returning()
						.get();
					progressMap.set(key, toReadingProgress(inserted));
				} else {
					const existingHiddenAt = existing.historyHiddenAt ?? null;
					const mergedHiddenAt =
						incomingHiddenAt === null
							? existingHiddenAt
							: existingHiddenAt === null
								? incomingHiddenAt
								: Math.max(existingHiddenAt, incomingHiddenAt);
					const progressWins = effectiveUpdatedAt >= existing.updatedAt;
					const hiddenChanged = mergedHiddenAt !== existingHiddenAt;

					if (progressWins || hiddenChanged) {
						const serverUpdatedAt = nextCursor();
						const updated = await tx
							.update(readingProgress)
							.set(
								progressWins
									? {
											novelTitle: item.novelTitle,
											coverUrl: item.coverUrl,
											volumeId: item.volumeId,
											volumeTitle: item.volumeTitle,
											chapterId: item.chapterId,
											chapterTitle: item.chapterTitle,
											paragraphIndex: item.paragraphIndex,
											totalParagraphs: item.totalParagraphs,
											deviceLabel: item.deviceLabel,
											deviceKind: normalizeDeviceKind(item.deviceKind),
											updatedAt: effectiveUpdatedAt,
											serverUpdatedAt,
											historyHiddenAt: mergedHiddenAt,
										}
									: {
											serverUpdatedAt,
											historyHiddenAt: mergedHiddenAt,
										},
							)
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
			}

			const enrichedBookshelf =
				await this.enrichBookshelfItemsWithNovelMetadata(
					tx,
					Array.from(bookshelfMap.values()),
				);

			const serverTime = Math.max(Date.now(), lastCursor);
			return {
				bookshelf: enrichedBookshelf,
				progress: Array.from(progressMap.values()),
				categories: Array.from(categoryMap.values()),
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
