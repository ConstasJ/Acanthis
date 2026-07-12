export const browserProfileNames = [
	"chrome-latest-linux",
	"chrome-latest-windows",
	"chrome-latest-android",
	"chrome150-linux",
	"chrome150-windows",
	"chrome150-android",
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

const commonHeaders = {
	"Sec-Fetch-Dest": "document",
	"Sec-Fetch-Mode": "navigate",
	"Sec-Fetch-Site": "none",
	"Sec-Fetch-User": "?1",
	Accept:
		"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
	"Accept-Language": "zh-CN,zh;q=0.9",
	Priority: "u=0, i",
	"Upgrade-Insecure-Requests": "1",
};

const platformCommonHeaders = {
	linux: {
		"Sec-Ch-Ua-Platform": '"Linux"',
		"Sec-Ch-Ua-Mobile": "?0",
		...commonHeaders,
	},
	windows: {
		"Sec-Ch-Ua-Platform": '"Windows"',
		"Sec-Ch-Ua-Mobile": "?0",
		...commonHeaders,
	},
	android: {
		"Sec-Ch-Ua-Platform": '"Android"',
		"Sec-Ch-Ua-Mobile": "?1",
		...commonHeaders,
	},
};

const platformUASpecific = {
	linux: "X11; Linux x86_64",
	windows: "Windows NT 10.0; Win64; x64",
	android: "Linux; Android 10; K",
};

const versionUATemplate = {
	"149": {
		"User-Agent":
			"Mozilla/5.0 ({platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
		"Sec-Ch-Ua":
			'"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
	},
	"150": {
		"User-Agent":
			"Mozilla/5.0 ({platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
		"Sec-Ch-Ua":
			'"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
	},
};

function generateUA(
	version: keyof typeof versionUATemplate,
	platform: "linux" | "windows" | "android",
) {
	const uaTemplate = versionUATemplate[version];
	if (!uaTemplate) {
		throw new Error(`Unknown user agent template for version: ${version}`);
	}
	return uaTemplate["User-Agent"].replace(
		"{platform}",
		platformUASpecific[platform],
	);
}

export const browserProfiles: Record<BrowserProfileName, BrowserProfile> = {
	get "chrome-latest-linux"() {
		return this["chrome150-linux"];
	},
	get "chrome-latest-windows"() {
		return this["chrome150-windows"];
	},
	get "chrome-latest-android"() {
		return this["chrome150-android"];
	},
	"chrome150-linux": {
		name: "chrome150-linux",
		headers: {
			"User-Agent": generateUA("150", "linux"),
			"Sec-Ch-Ua": versionUATemplate["150"]["Sec-Ch-Ua"],
			...platformCommonHeaders.linux,
		},
		impersonate: "chrome146",
	},
	"chrome150-windows": {
		name: "chrome150-windows",
		headers: {
			"User-Agent": generateUA("150", "windows"),
			"Sec-Ch-Ua": versionUATemplate["150"]["Sec-Ch-Ua"],
			...platformCommonHeaders.windows,
		},
		impersonate: "chrome146",
	},
	"chrome150-android": {
		name: "chrome150-android",
		headers: {
			"User-Agent": generateUA("150", "android"),
			"Sec-Ch-Ua": versionUATemplate["150"]["Sec-Ch-Ua"],
			...platformCommonHeaders.android,
		},
		impersonate: "chrome146",
	},
	"chrome149-linux": {
		name: "chrome149-linux",
		headers: {
			"User-Agent": generateUA("149", "linux"),
			"Sec-Ch-Ua": versionUATemplate["149"]["Sec-Ch-Ua"],
			...platformCommonHeaders.linux,
		},
		impersonate: "chrome146",
	},
	"chrome149-windows": {
		name: "chrome149-windows",
		headers: {
			"User-Agent": generateUA("149", "windows"),
			"Sec-Ch-Ua": versionUATemplate["149"]["Sec-Ch-Ua"],
			...platformCommonHeaders.windows,
		},
		impersonate: "chrome146",
	},
	"chrome149-android": {
		name: "chrome149-android",
		headers: {
			"User-Agent": generateUA("149", "android"),
			"Sec-Ch-Ua": versionUATemplate["149"]["Sec-Ch-Ua"],
			...platformCommonHeaders.android,
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
