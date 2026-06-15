import type {
	BinaryResponse,
	BrowserFetchClient,
} from "@acanthis-dec/browser-fetch";
import type { StorageService } from "@acanthis-dec/storage";

export function novelIdToCoverUrl(novelId: string): string {
	const prefix = novelId.length > 3 ? novelId[0] : "0";
	return `https://www.linovelib.com/files/article/image/${prefix}/${novelId}/${novelId}s.jpg`;
}

export async function getCover(
	novelId: string,
	fetchClient: BrowserFetchClient,
	storage?: StorageService,
): Promise<BinaryResponse> {
	const url = novelIdToCoverUrl(novelId);
	if (storage) {
		const coverData = await storage.getCoverData("linovelib", novelId);
		if (coverData) {
			return coverData;
		}
	}
	const response = await fetchClient.binary(url);
	if (storage) {
		await storage.setCoverData(
			url,
			response.data,
			response.mimeType,
			"linovelib",
			novelId,
		);
	}
	return response;
}
