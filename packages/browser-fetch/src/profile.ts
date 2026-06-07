export type BrowserProfileName =
	| "chrome146-linux"
	| "chrome146-win"
	| "chrome146-android";

export type BrowserProfile = {
	name: BrowserProfileName;
	userAgent: string;
	headers: Record<string, string>;
	viewport?: {
		width: number;
		height: number;
	};
	impersonate?: string;
};

export const browserProfiles: Record<BrowserProfileName, BrowserProfile> = {
	"chrome146-linux": {
		name: "chrome146-linux",
		userAgent:
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
		headers: {},
	},
	"chrome146-win": {
		name: "chrome146-win",
		userAgent:
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
		headers: {},
	},
	"chrome146-android": {
		name: "chrome146-android",
		userAgent:
			"Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36",
		headers: {},
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
