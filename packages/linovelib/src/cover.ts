import type {
	BinaryResponse,
	BrowserFetchClient,
} from "@acanthis-dec/browser-fetch";

export function novelIdToCoverUrl(novelId: string): string {
	const prefix = novelId.length > 3 ? novelId[0] : "0";
	return `https://www.linovelib.com/files/article/image/${prefix}/${novelId}/${novelId}s.jpg`;
}

export async function getCover(
	novelId: string,
	fetchClient: BrowserFetchClient,
): Promise<BinaryResponse> {
	const url = novelIdToCoverUrl(novelId);
	const response = await fetchClient.binary(url);
	return response;
}
