import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
	EPUB_CONTENT_SCHEMA_VERSION,
	type EpubCachedArtifact,
	type EpubCacheKey,
	type EpubCacheMetadata,
	type EpubLogger,
	type EpubProfile,
} from "./types";

export interface ChapterFingerprintEntry {
	id: string;
	contentHash: string;
}

export interface VolumeContentFingerprintInput {
	platform: string;
	novelId: string;
	volumeId: string;
	profile: EpubProfile;
	epubSchemaVersion?: number | undefined;
	coverHash: string;
	chapters: readonly ChapterFingerprintEntry[];
}

export interface VolumeChapterSignatureInput {
	platform: string;
	novelId: string;
	volumeId: string;
	profile: EpubProfile;
	epubSchemaVersion?: number | undefined;
	chapters: readonly ChapterFingerprintEntry[];
}

export function computeVolumeChapterSignature(
	input: VolumeChapterSignatureInput,
): string {
	const payload = JSON.stringify({
		platform: input.platform,
		novelId: input.novelId,
		volumeId: input.volumeId,
		profile: input.profile,
		epubSchemaVersion: input.epubSchemaVersion ?? EPUB_CONTENT_SCHEMA_VERSION,
		chapters: input.chapters.map((chapter) => [
			chapter.id,
			chapter.contentHash,
		]),
	});
	return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function computeVolumeContentFingerprint(
	input: VolumeContentFingerprintInput,
): string {
	const payload = JSON.stringify({
		platform: input.platform,
		novelId: input.novelId,
		volumeId: input.volumeId,
		profile: input.profile,
		epubSchemaVersion: input.epubSchemaVersion ?? EPUB_CONTENT_SCHEMA_VERSION,
		coverHash: input.coverHash,
		chapters: input.chapters.map((chapter) => [
			chapter.id,
			chapter.contentHash,
		]),
	});
	return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function sanitizePathSegment(segment: string, label: string): string {
	const trimmed = segment.trim();
	if (
		!trimmed ||
		trimmed === "." ||
		trimmed === ".." ||
		trimmed.includes("/") ||
		trimmed.includes("\\") ||
		trimmed.includes("\0")
	) {
		throw new Error(`Invalid EPUB cache path segment for ${label}: ${segment}`);
	}
	return trimmed;
}

function isValidCacheMetadata(value: unknown): value is EpubCacheMetadata {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.contentFingerprint === "string" &&
		record.contentFingerprint.length > 0 &&
		typeof record.sizeBytes === "number" &&
		Number.isFinite(record.sizeBytes) &&
		record.sizeBytes >= 0 &&
		typeof record.chapterCount === "number" &&
		Number.isInteger(record.chapterCount) &&
		record.chapterCount >= 0 &&
		typeof record.generatedAt === "string" &&
		typeof record.lastAccessedAt === "number" &&
		Number.isFinite(record.lastAccessedAt) &&
		Array.isArray(record.warnings) &&
		record.warnings.every((item) => typeof item === "string")
	);
}

async function atomicWriteFile(
	targetPath: string,
	data: Uint8Array | string,
): Promise<void> {
	const dir = dirname(targetPath);
	await mkdir(dir, { recursive: true });
	const tmpPath = `${targetPath}.tmp.${randomUUID()}`;
	try {
		await writeFile(tmpPath, data);
		await rename(tmpPath, targetPath);
	} catch (error) {
		await unlink(tmpPath).catch(() => {});
		throw error;
	}
}

interface CacheDiskEntry {
	epubPath: string;
	metaPath: string;
	sizeBytes: number;
	lastAccessedAt: number;
}

export interface EpubDiskCacheOptions {
	cacheDir: string;
	maxCacheBytes: number;
	logger?: EpubLogger | undefined;
}

export class EpubDiskCache {
	private readonly rootDir: string;
	private readonly maxCacheBytes: number;
	private readonly logger?: EpubLogger | undefined;
	private evictionPromise: Promise<number> | null = null;

	constructor(options: EpubDiskCacheOptions) {
		this.rootDir = resolve(options.cacheDir);
		this.maxCacheBytes = Math.max(1, Math.floor(options.maxCacheBytes));
		this.logger = options.logger;
	}

	private resolveEntryPaths(key: EpubCacheKey): {
		epubPath: string;
		metaPath: string;
	} {
		const platform = sanitizePathSegment(key.platform, "platform");
		const novelId = sanitizePathSegment(key.novelId, "novelId");
		const volumeId = sanitizePathSegment(key.volumeId, "volumeId");
		const profile = sanitizePathSegment(key.profile, "profile");
		const dir = resolve(this.rootDir, platform, novelId, volumeId);
		const rel = relative(this.rootDir, dir);
		if (rel.startsWith("..") || rel.includes(`..${sep}`) || rel === "") {
			throw new Error("EPUB cache path escaped cacheDir");
		}
		return {
			epubPath: join(dir, `${profile}.epub`),
			metaPath: join(dir, `${profile}.meta.json`),
		};
	}

	getEpubPath(key: EpubCacheKey): string {
		return this.resolveEntryPaths(key).epubPath;
	}

	async getMetadata(key: EpubCacheKey): Promise<EpubCacheMetadata | null> {
		const artifact = await this.getArtifact(key, { touch: false });
		return artifact ? artifact.metadata : null;
	}

	async getArtifact(
		key: EpubCacheKey,
		options?: { touch?: boolean | undefined },
	): Promise<EpubCachedArtifact | null> {
		const { epubPath, metaPath } = this.resolveEntryPaths(key);
		try {
			const [epubStat, rawMeta] = await Promise.all([
				stat(epubPath),
				readFile(metaPath, "utf8"),
			]);
			if (!epubStat.isFile()) {
				return null;
			}
			const parsed: unknown = JSON.parse(rawMeta);
			if (!isValidCacheMetadata(parsed)) {
				return null;
			}

			const metadata: EpubCacheMetadata = {
				...parsed,
				sizeBytes: epubStat.size,
			};

			if (options?.touch) {
				metadata.lastAccessedAt = Date.now();
				await atomicWriteFile(
					metaPath,
					`${JSON.stringify(metadata, null, 2)}\n`,
				).catch((error) => {
					this.logger?.warn(
						`[EPUB] 更新缓存 lastAccessedAt 失败: path=${metaPath} error=${error instanceof Error ? error.message : String(error)}`,
					);
				});
			}

			return {
				epubPath,
				sizeBytes: epubStat.size,
				metadata,
			};
		} catch {
			return null;
		}
	}

	async writeArtifact(
		key: EpubCacheKey,
		bytes: Uint8Array,
		meta: Omit<EpubCacheMetadata, "sizeBytes" | "lastAccessedAt"> & {
			lastAccessedAt?: number | undefined;
		},
	): Promise<EpubCacheMetadata> {
		const { epubPath, metaPath } = this.resolveEntryPaths(key);
		const now = Date.now();
		const fullMeta: EpubCacheMetadata = {
			...meta,
			sizeBytes: bytes.byteLength,
			lastAccessedAt: meta.lastAccessedAt ?? now,
		};

		await atomicWriteFile(epubPath, bytes);
		await atomicWriteFile(metaPath, `${JSON.stringify(fullMeta, null, 2)}\n`);

		try {
			await this.evictIfNeeded(epubPath);
		} catch (error) {
			this.logger?.warn(
				`[EPUB] 磁盘缓存 LRU 清理失败: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		return fullMeta;
	}

	async evictIfNeeded(protectedEpubPath?: string): Promise<number> {
		if (this.evictionPromise) {
			return await this.evictionPromise;
		}

		const run = this.runEviction(protectedEpubPath).finally(() => {
			if (this.evictionPromise === run) {
				this.evictionPromise = null;
			}
		});
		this.evictionPromise = run;
		return await run;
	}

	private async runEviction(protectedEpubPath?: string): Promise<number> {
		const entries = await this.scanEntries(this.rootDir);
		let totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
		if (totalBytes <= this.maxCacheBytes) {
			return 0;
		}

		entries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

		let evictedCount = 0;
		for (const entry of entries) {
			if (totalBytes <= this.maxCacheBytes) {
				break;
			}
			if (protectedEpubPath && entry.epubPath === protectedEpubPath) {
				continue;
			}
			await rm(entry.epubPath, { force: true }).catch(() => {});
			await rm(entry.metaPath, { force: true }).catch(() => {});
			totalBytes -= entry.sizeBytes;
			evictedCount += 1;
			this.logger?.debug(
				`[EPUB] LRU 淘汰磁盘缓存: path=${entry.epubPath} sizeBytes=${entry.sizeBytes} remainingBytes=${totalBytes}`,
			);
		}

		return evictedCount;
	}

	private async scanEntries(dir: string): Promise<CacheDiskEntry[]> {
		let dirEntries: Dirent<string>[];
		try {
			dirEntries = await readdir(dir, { withFileTypes: true });
		} catch {
			return [];
		}

		const results: CacheDiskEntry[] = [];
		for (const dirent of dirEntries) {
			const fullPath = join(dir, dirent.name);
			if (dirent.isDirectory()) {
				const nested = await this.scanEntries(fullPath);
				results.push(...nested);
				continue;
			}
			if (!dirent.isFile() || !dirent.name.endsWith(".epub")) {
				continue;
			}
			const metaPath = `${fullPath.slice(0, -".epub".length)}.meta.json`;
			try {
				const epubStat = await stat(fullPath);
				let lastAccessedAt = epubStat.mtimeMs;
				try {
					const rawMeta = await readFile(metaPath, "utf8");
					const parsed: unknown = JSON.parse(rawMeta);
					if (isValidCacheMetadata(parsed)) {
						lastAccessedAt = parsed.lastAccessedAt;
					}
				} catch {
					// 如果 meta 缺失或损坏，使用文件 mtime 参与淘汰排序
				}
				results.push({
					epubPath: fullPath,
					metaPath,
					sizeBytes: epubStat.size,
					lastAccessedAt,
				});
			} catch {
				// 并发删除的文件直接忽略
			}
		}

		return results;
	}
}
