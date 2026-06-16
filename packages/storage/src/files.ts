import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { BinaryResponse } from "@acanthis-dec/browser-fetch";
import type { DatabaseService } from "./db";
import type { NovelCoverMetadata, VolumeCoverMetadata } from "./type";
import {
	getContentHash,
	getCoverHash,
	getExtFromContentType,
	zstdCompress,
	zstdDecompress,
} from "./utils";

export class FSStorageService {
	private basePath: string;
	private dbService: DatabaseService;

	constructor(basePath: string, dbService: DatabaseService) {
		this.basePath = basePath;
		this.dbService = dbService;
	}

	private async _initPath(path: string): Promise<void> {
		if (!existsSync(path)) {
			await mkdir(path, { recursive: true });
		} else if (existsSync(path) && !(await stat(path)).isDirectory()) {
			await rm(path);
			await mkdir(path, { recursive: true });
		}
	}

	async getNovelContent(hash: string): Promise<string | undefined> {
		const novelCacheDir = `${this.basePath}/novels/${hash.slice(0, 2)}`;
		const chapterFilePath = `${novelCacheDir}/${hash}.zst`;
		if (!existsSync(chapterFilePath)) {
			return undefined;
		}
		const compressedData = await readFile(chapterFilePath);
		const decompressedData = await zstdDecompress(compressedData);
		return new TextDecoder().decode(decompressedData);
	}

	async setNovelContent(content: string): Promise<string> {
		const hash = getContentHash(content);
		const novelCacheDir = `${this.basePath}/novels/${hash.slice(0, 2)}`;
		await this._initPath(novelCacheDir);
		const chapterFilePath = `${novelCacheDir}/${hash}.zst`;
		const compressedData = await zstdCompress(Buffer.from(content, "utf-8"));
		await writeFile(chapterFilePath, compressedData);
		return hash;
	}

	async getCoverData(
		type: "novel" | "volume",
		platform: string,
		platformId: string,
	): Promise<BinaryResponse | undefined> {
		let meta: NovelCoverMetadata | VolumeCoverMetadata | undefined;
		if (type === "novel") {
			meta = await this.dbService.getNovelCoverMetadata(platform, platformId);
		} else if (type === "volume") {
			meta = await this.dbService.getVolumeCoverMetadata(platform, platformId);
		}
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
		type: "novel" | "volume",
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
		if (type === "novel") {
			await this.dbService.addNovelCoverMetadata({
				platform,
				novelId: platformId,
				hash: coverHash,
				contentType,
				originalUrl: url,
			});
		} else if (type === "volume") {
			await this.dbService.addVolumeCoverMetadata({
				platform,
				volumeId: platformId,
				hash: coverHash,
				contentType,
				originalUrl: url,
			});
		}
	}
}
