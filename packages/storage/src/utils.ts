import { createHash } from "node:crypto";
import { zstdCompress as zc, zstdDecompress as zd } from "node:zlib";

export const zstdCompress = (data: Buffer): Promise<Buffer> => {
	return new Promise((resolve, reject) => {
		zc(data, (err, compressedData) => {
			if (err) {
				reject(err);
			} else {
				resolve(compressedData);
			}
		});
	});
};

export const zstdDecompress = (data: Buffer): Promise<Buffer> => {
	return new Promise((resolve, reject) => {
		zd(data, (err, decompressedData) => {
			if (err) {
				reject(err);
			} else {
				resolve(decompressedData);
			}
		});
	});
};

export function getCoverHash(data: Buffer): string {
	return createHash("md5").update(data).digest("hex");
}

export function getExtFromContentType(contentType: string): string {
	if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
	if (contentType.includes("png")) return "png";
	if (contentType.includes("gif")) return "gif";
	if (contentType.includes("webp")) return "webp";
	if (contentType.includes("avif")) return "avif";
	return "bin";
}
