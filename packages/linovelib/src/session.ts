import type { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import type { StorageService } from "@acanthis-dec/storage";
import z from "zod";

export interface LoginConfig {
	username: string;
	password: string;
}

export async function fetchSessionId(
	fetchClient: BrowserFetchClient,
	loginConfig: LoginConfig,
): Promise<string | undefined> {
	await fetchClient.request({
		url: "https://www.linovelib.com/login.php",
		method: "GET",
	});
	const response = await fetchClient.request({
		url: "https://www.linovelib.com/login.php?do=submit&jumpurl=https%3A%2F%2Fwww.linovelib.com%2F",
		method: "POST",
		body: new URLSearchParams({
			username: loginConfig.username,
			password: loginConfig.password,
			usecookie: "3153600000",
			submit: "登录",
			action: "login",
		}),
		followRedirects: false,
	});

	return response.cookies.find((cookie) => cookie.name === "PHPSESSID")?.value;
}

export async function isSessionValid(
	sessionId: string,
	fetchClient: BrowserFetchClient,
): Promise<boolean> {
	const response = await fetchClient.text("https://www.linovelib.com", {
		cookies: {
			PHPSESSID: sessionId,
		},
	});
	if (response.data.includes("用户中心")) return true;
	else return false;
}

export async function ensureValidSession(
	storage: StorageService,
	fetchClient: BrowserFetchClient,
	loginConfig: LoginConfig,
): Promise<void> {
	const sessionId = await storage.getCache<string>("sessionId", z.string());
	if (sessionId && (await isSessionValid(sessionId, fetchClient))) {
		return;
	}

	const newSessionId = await fetchSessionId(fetchClient, loginConfig);
	if (newSessionId) {
		await storage.setCache("sessionId", newSessionId);
		return;
	}

	throw new Error("Failed to obtain a valid session");
}
