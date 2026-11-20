import type { Cookie } from "./cookies";
import { FlareSolverrError } from "./errors";
import type {
	FlareSolverrClient,
	FlareSolverrCookie,
	FlareSolverrSolution,
} from "./flaresolverr";

export type CloudflareChallengeResult = {
	clearance: Cookie;
	cookies: Cookie[];
	solution: FlareSolverrSolution;
	status: number;
	elapsedTime?: number | undefined;
};

function toCookie(cookie: FlareSolverrCookie): Cookie {
	return {
		name: cookie.name,
		value: cookie.value,
		domain: cookie.domain,
		path: cookie.path,
		expires:
			typeof cookie.expiry === "number" && cookie.expiry > 0
				? new Date(cookie.expiry * 1000)
				: undefined,
		httpOnly: cookie.httpOnly,
		secure: cookie.secure,
		sameSite: cookie.sameSite ?? "Lax",
	};
}

export type AutoSolvePolicy = "auto" | "force-refresh" | "never";

export type AutoSolveDetectorType = "cloudflare" | "custom";

export type ChallengeDetector = (statusCode: number, body: string) => boolean;

export type ChallengeOptions = {
	autoSolve: AutoSolvePolicy;
	detector: AutoSolveDetectorType;
	customDetector?: ChallengeDetector;
};

export function getDetector(options: ChallengeOptions): ChallengeDetector {
	switch (options.detector) {
		case "cloudflare":
			return detectCloudflareChallenge;
		case "custom":
			if (!options.customDetector) {
				throw new Error(
					"Custom detector function must be provided when using 'custom' detector type.",
				);
			}
			return options.customDetector;
		default:
			throw new Error(`Unsupported detector type: ${options.detector}`);
	}
}

export function detectCloudflareChallenge(
	statusCode: number,
	body: string,
): boolean {
	return statusCode === 403 && body.includes("Just a moment...");
}

export function detectCloudflareBlock(
	statusCode: number,
	body: string,
): boolean {
	return (
		(statusCode === 403 && body.includes("Attention Required!")) ||
		statusCode === 429
	);
}

export async function solveCloudflareChallenge(
	url: string,
	method: "GET" | "POST",
	client: FlareSolverrClient,
	body?: Record<string, string>,
): Promise<CloudflareChallengeResult> {
	const response =
		method === "GET"
			? await client.get(url)
			: await client.post(url, body ?? {});

	if (response.status !== "ok" && response.message !== "Challenge solved!") {
		throw new FlareSolverrError(
			client.host,
			`Failed to solve Cloudflare challenge: ${response.message}`,
		);
	}
	const rawCookies = response.solution.cookies ?? [];
	const clearance = rawCookies.find((cookie) =>
		cookie.name.toLowerCase().includes("cf_clearance"),
	);
	if (!clearance) {
		throw new FlareSolverrError(
			client.host,
			"Failed to find cf_clearance cookie in FlareSolverr response.",
		);
	}
	const parsedStatus = Number(response.solution.status);
	const status = Number.isFinite(parsedStatus) ? parsedStatus : 0;
	const elapsedTime =
		typeof response.startTimestamp === "number" &&
		typeof response.endTimestamp === "number" &&
		response.endTimestamp >= response.startTimestamp
			? response.endTimestamp - response.startTimestamp
			: undefined;

	return {
		clearance: toCookie(clearance),
		cookies: rawCookies.map(toCookie),
		solution: response.solution,
		status,
		elapsedTime,
	};
}
