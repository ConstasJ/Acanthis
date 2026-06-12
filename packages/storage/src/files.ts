import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

	private async _initPath(): Promise<void> {
		if (!this.isPathInitialized) {
			if (!existsSync(this.basePath)) {
				await mkdir(this.basePath, { recursive: true });
			} else if (
				existsSync(this.basePath) &&
				!(await stat(this.basePath)).isDirectory()
			) {
				await rm(this.basePath);
				await mkdir(this.basePath, { recursive: true });
			}
			this.isPathInitialized = true;
		}
	}

	async getNovelContent(
		novelId: string,
		chapterId: string,
	): Promise<string | undefined> {
		await this._initPath();
		const novelCacheDir = `${this.basePath}/novels/${novelId}`;
		if (
			!existsSync(novelCacheDir) ||
			(await stat(novelCacheDir)).isDirectory() === false
		) {
			return undefined;
		}
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
		await this._initPath();
		const novelCacheDir = `${this.basePath}/novels/${novelId}`;
		if (!existsSync(novelCacheDir)) {
			await mkdir(novelCacheDir, { recursive: true });
		} else if (
			existsSync(novelCacheDir) &&
			!(await stat(novelCacheDir)).isDirectory()
		) {
			await rm(novelCacheDir);
			await mkdir(novelCacheDir, { recursive: true });
		}
		const chapterFilePath = `${novelCacheDir}/${chapterId}.zst`;
		const compressedData = await zstdCompress(Buffer.from(content, "utf-8"));
		await writeFile(chapterFilePath, compressedData);
	}

	async getCoverData(url: string): Promise<Buffer | undefined> {
		await this._initPath();
		const coverHash = getCoverHash(url);
		const meta = await this.dbService.getCoverMetadata(coverHash);
		if (!meta) {
			return undefined;
		}
		const coverPath = `${this.basePath}/covers/${coverHash}.${meta.ext}`;
		if (!existsSync(coverPath)) {
			return undefined;
		}
		return await readFile(coverPath);
	}

	async setCoverData(
		url: string,
		data: Buffer,
		contentType: string,
	): Promise<void> {
		await this._initPath();
		const coverHash = getCoverHash(url);
		const ext = getExtFromContentType(contentType);
		const coverPath = `${this.basePath}/covers/${coverHash}.${ext}`;
		await writeFile(coverPath, data);
		await this.dbService.addCoverMetadata({
			hash: coverHash,
			contentType,
			originalUrl: url,
			ext,
		});
	}
}
