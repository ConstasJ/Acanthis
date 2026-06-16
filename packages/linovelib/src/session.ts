import type { BrowserFetchClient } from "@acanthis-dec/browser-fetch";

export interface LoginConfig {
	username: string;
	password: string;
}

export async function refreshSessionId(
	fetchClient: BrowserFetchClient,
	loginConfig: LoginConfig,
): Promise<boolean> {
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
	return (
		response.cookies.findIndex((cookie) => cookie.name === "PHPSESSID") !== -1
	);
}

export async function hasValidSession(
	fetchClient: BrowserFetchClient,
): Promise<boolean> {
	const response = await fetchClient.text("https://www.linovelib.com");
	if (response.data.includes("用户中心")) return true;
	else return false;
}

export async function ensureValidSession(
	fetchClient: BrowserFetchClient,
	loginConfig: LoginConfig,
): Promise<boolean> {
	if (!(await hasValidSession(fetchClient))) {
		const isValid =
			(await refreshSessionId(fetchClient, loginConfig)) &&
			(await hasValidSession(fetchClient));
		if (!isValid) {
			return false;
		}
	}
	return true;
}
