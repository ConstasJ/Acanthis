import type { EpubImageAsset } from "@acanthis-dec/epub";
import sharp from "sharp";
import type { EpubImageProcessor, EpubLogger, EpubProfile } from "./types";

export const EINK_MAX_WIDTH = 1072;
export const EINK_JPEG_QUALITY = 78;

export class PassthroughEpubImageProcessor implements EpubImageProcessor {
	async process(
		asset: EpubImageAsset,
		_profile: EpubProfile,
	): Promise<EpubImageAsset> {
		return asset;
	}
}

export class SharpEpubImageProcessor implements EpubImageProcessor {
	private readonly logger?: EpubLogger | undefined;

	constructor(logger?: EpubLogger) {
		this.logger = logger;
	}

	async process(
		asset: EpubImageAsset,
		profile: EpubProfile,
	): Promise<EpubImageAsset> {
		if (profile !== "eink") {
			return asset;
		}
		if (asset.data.byteLength === 0) {
			this.logger?.warn(
				`[EPUB] 空图片字节流，跳过 sharp 处理并回退原图: url=${asset.sourceUrl}`,
			);
			return asset;
		}

		try {
			const processedBuffer = await sharp(asset.data)
				.rotate()
				.resize({
					width: EINK_MAX_WIDTH,
					withoutEnlargement: true,
					fit: "inside",
				})
				.grayscale()
				.toColourspace("b-w")
				.jpeg({
					quality: EINK_JPEG_QUALITY,
					mozjpeg: true,
				})
				.toBuffer();

			return {
				sourceUrl: asset.sourceUrl,
				data: new Uint8Array(
					processedBuffer.buffer,
					processedBuffer.byteOffset,
					processedBuffer.byteLength,
				),
				mimeType: "image/jpeg",
			};
		} catch (error) {
			this.logger?.warn(
				`[EPUB] sharp 解码或压缩图片失败，已回退原图: url=${asset.sourceUrl} mimeType=${asset.mimeType} error=${error instanceof Error ? error.message : String(error)}`,
			);
			return asset;
		}
	}
}
