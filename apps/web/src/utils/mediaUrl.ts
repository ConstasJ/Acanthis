export function normalizeBaseUrl(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

export function stripTrailingV1Prefix(url: string): string {
	const normalized = normalizeBaseUrl(url);
	return normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
}

export function rebaseMediaUrlWithBase(
	rawUrl: string | null | undefined,
	apiBaseUrl: string,
): string {
	if (!rawUrl) {
		return "";
	}
	const trimmed = rawUrl.trim();
	if (!trimmed) {
		return "";
	}

	const base = stripTrailingV1Prefix(normalizeBaseUrl(apiBaseUrl));

	if (trimmed.startsWith("/v1/")) {
		return `${base}${trimmed}`;
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return trimmed;
	}

	const v1Index = parsed.pathname.indexOf("/v1/");
	if (v1Index === -1) {
		return trimmed;
	}

	const v1PathAndQuery = `${parsed.pathname.slice(v1Index)}${parsed.search}`;
	return `${base}${v1PathAndQuery}`;
}
