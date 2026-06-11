export type BrowserProfileName =
	| "chrome149-linux"
	| "chrome149-win"
	| "chrome149-android";

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
	"chrome149-linux": {
		name: "chrome149-linux",
		userAgent:
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
		headers: {},
		impersonate: "chrome146",
	},
	"chrome149-win": {
		name: "chrome149-win",
		userAgent:
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
		headers: {},
		impersonate: "chrome146",
	},
	"chrome149-android": {
		name: "chrome149-android",
		userAgent:
			"Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
		headers: {},
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
