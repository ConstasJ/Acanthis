import type { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import type { Logger } from "winston";

export interface LoginConfig {
	username: string;
	password: string;
}

export async function refreshSessionId(
	fetchClient: BrowserFetchClient,
	loginConfig: LoginConfig,
	logger?: Logger,
): Promise<boolean> {
	const startAt = Date.now();
	logger?.debug(
		`[Session] 开始刷新登录会话: username=${JSON.stringify(loginConfig.username)}`,
	);
	await fetchClient.request({
		url: "https://www.linovelib.com/login.php",
		method: "GET",
		headers: {
			referer: "https://www.linovelib.com/",
		},
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
	const hasPhpSessionId =
		response.cookies.findIndex((cookie) => cookie.name === "PHPSESSID") !== -1;
	logger?.debug(
		`[Session] 登录提交完成: status=${response.status} hasPhpSessionId=${hasPhpSessionId} duration=${Date.now() - startAt}ms`,
	);
	return hasPhpSessionId;
}

export async function hasValidSession(
	fetchClient: BrowserFetchClient,
	logger?: Logger,
): Promise<boolean> {
	const startAt = Date.now();
	const response = await fetchClient.text("https://www.linovelib.com");
	const valid = response.data.includes("用户中心");
	logger?.debug(
		`[Session] 会话有效性检查完成: valid=${valid} duration=${Date.now() - startAt}ms`,
	);
	return valid;
}

export async function ensureValidSession(
	fetchClient: BrowserFetchClient,
	loginConfig: LoginConfig,
	logger?: Logger,
): Promise<boolean> {
	if (!(await hasValidSession(fetchClient, logger))) {
		logger?.debug("[Session] 当前会话无效或已过期，尝试重新登录");
		const isValid =
			(await refreshSessionId(fetchClient, loginConfig, logger)) &&
			(await hasValidSession(fetchClient, logger));
		if (!isValid) {
			logger?.warn("[Session] 重新登录后会话仍无效");
			return false;
		}
	}
	return true;
}
