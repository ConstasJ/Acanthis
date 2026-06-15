import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { BinaryResponse } from "@acanthis-dec/browser-fetch";
import type { DatabaseService } from "./db";
import {
	getCoverHash,
	getExtFromContentType,
	zstdCompress,
	zstdDecompress,
} from "./utils";

export class FSStorageService {
	private basePath: string;
	private isPathInitialized: boolean = false;
	private dbService: DatabaseService;

	constructor(basePath: string, dbService: DatabaseService) {
		this.basePath = basePath;
		this.dbService = dbService;
	}

	private async _initPath(path: string): Promise<void> {
		if (!this.isPathInitialized) {
			if (!existsSync(path)) {
				await mkdir(path, { recursive: true });
			} else if (
				existsSync(path) &&
				!(await stat(path)).isDirectory()
			) {
				await rm(path);
				await mkdir(path, { recursive: true });
			}
			this.isPathInitialized = true;
		}
	}

	async getNovelContent(
		novelId: string,
		chapterId: string,
	): Promise<string | undefined> {
		const novelCacheDir = `${this.basePath}/novels/${novelId}`;
		const chapterFilePath = `${novelCacheDir}/${chapterId}.zst`;
		if (!existsSync(chapterFilePath)) {
			return undefined;
		}
		const compressedData = await readFile(chapterFilePath);
		const decompressedData = await zstdDecompress(compressedData);
		return new TextDecoder().decode(decompressedData);
	}

	async setNovelContent(
		novelId: string,
		chapterId: string,
		content: string,
	): Promise<void> {
		const novelCacheDir = `${this.basePath}/novels/${novelId}`;
		await this._initPath(novelCacheDir);
		const chapterFilePath = `${novelCacheDir}/${chapterId}.zst`;
		const compressedData = await zstdCompress(Buffer.from(content, "utf-8"));
		await writeFile(chapterFilePath, compressedData);
	}

	async getCoverData(
		platform: string,
		novelId: string,
	): Promise<BinaryResponse | undefined> {
		const meta = await this.dbService.getCoverMetadata(platform, novelId);
		if (!meta) {
			return undefined;
		}
		const coverPath = `${this.basePath}/covers/${meta.hash.slice(0, 2)}/${meta.hash}.${getExtFromContentType(meta.contentType)}`;
		if (!existsSync(coverPath)) {
			return undefined;
		}
		const data = await readFile(coverPath);
		return { data, mimeType: meta.contentType };
	}

	async setCoverData(
		url: string,
		platform: string,
		platformId: string,
		data: Buffer,
		contentType: string,
	): Promise<void> {
		const coverHash = getCoverHash(data);
		const ext = getExtFromContentType(contentType);
		const coverDir = `${this.basePath}/covers/${coverHash.slice(0, 2)}`;
		await this._initPath(coverDir);
		const coverPath = `${coverDir}/${coverHash}.${ext}`;
		await writeFile(coverPath, data);
		await this.dbService.addCoverMetadata({
			platform,
			novelId: platformId,
			hash: coverHash,
			contentType,
			originalUrl: url,
		});
	}
}
