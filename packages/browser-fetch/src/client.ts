import {
	type CookieStore,
	type CookieStoreOptions,
	FileCookieStore,
	InMemoryCookieStore,
} from "./cookies.js";
import {
	type BrowserProfile,
	type BrowserProfileName,
	parseBrowserProfile,
} from "./profile.js";

export type BrowserFetchClientOptions = {
	profile: BrowserProfileName | BrowserProfile;
	cookieStore: CookieStoreOptions;
};

export class BrowserFetchClient {
	private profile: BrowserProfile;
	private cookieStore: CookieStore;

	constructor(options: BrowserFetchClientOptions) {
		this.profile =
			typeof options.profile === "string"
				? parseBrowserProfile(options.profile)
				: options.profile;
		// Initialize cookie store based on options
		switch (options.cookieStore.type) {
			case "memory":
				this.cookieStore = new InMemoryCookieStore();
				break;
			case "file":
				if (!options.cookieStore.path) {
					throw new Error("File cookie store requires a path");
				}
				this.cookieStore = new FileCookieStore(options.cookieStore.path);
				break;
			default:
				throw new Error(
					`Unsupported cookie store type: ${options.cookieStore.type}`,
				);
		}
	}
}
