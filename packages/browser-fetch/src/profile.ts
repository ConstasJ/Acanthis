export const browserProfileNames = [
	"chrome149-linux",
	"chrome149-windows",
	"chrome149-android",
] as const;

export type BrowserProfileName = (typeof browserProfileNames)[number];

export type BrowserProfile = {
	name: BrowserProfileName;
	headers: Record<string, string>;
	viewport?: {
		width: number;
		height: number;
	};
	impersonate?: string;
};

export const browserProfiles: Record<BrowserProfileName, BrowserProfile> = {
	"chrome149-linux": {
		name: "chrome149-linux",
		headers: {
			"User-Agent":
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
			"Sec-Ch-Ua":
				'"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
			"Sec-Ch-Ua-Mobile": "?0",
			"Sec-Ch-Ua-Platform": '"Linux"',
			"Sec-Fetch-Dest": "document",
			"Sec-Fetch-Mode": "navigate",
			"Sec-Fetch-Site": "none",
			"Sec-Fetch-User": "?1",
			Accept:
				"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
			"Accept-Language": "zh-CN,zh;q=0.9",
			Priority: "u=0, i",
			"Upgrade-Insecure-Requests": "1",
		},
		impersonate: "chrome146",
	},
	"chrome149-windows": {
		name: "chrome149-windows",
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
			"Sec-Ch-Ua":
				'"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
			"Sec-Ch-Ua-Mobile": "?0",
			"Sec-Ch-Ua-Platform": '"Windows"',
			"Sec-Fetch-Dest": "document",
			"Sec-Fetch-Mode": "navigate",
			"Sec-Fetch-Site": "none",
			"Sec-Fetch-User": "?1",
			Accept:
				"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
			"Accept-Language": "zh-CN,zh;q=0.9",
			Priority: "u=0, i",
			"Upgrade-Insecure-Requests": "1",
		},
		impersonate: "chrome146",
	},
	"chrome149-android": {
		name: "chrome149-android",
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
			"Sec-Ch-Ua":
				'"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
			"Sec-Ch-Ua-Mobile": "?1",
			"Sec-Ch-Ua-Platform": '"Android"',
			"Sec-Fetch-Dest": "document",
			"Sec-Fetch-Mode": "navigate",
			"Sec-Fetch-Site": "none",
			"Sec-Fetch-User": "?1",
			Accept:
				"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
			"Accept-Language": "zh-CN,zh;q=0.9",
			Priority: "u=0, i",
			"Upgrade-Insecure-Requests": "1",
		},
		impersonate: "chrome146",
	},
};

export function parseBrowserProfile(
	profile: BrowserProfileName,
): BrowserProfile {
	const browserProfile = browserProfiles[profile];
	if (!browserProfile) {
		throw new Error(`Unknown browser profile: ${profile}`);
	}
	return browserProfile;
}
