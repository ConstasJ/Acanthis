import type { FlareSolverrClient } from "./flaresolverr.js";

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
	return (
		statusCode === 403 &&
		body.includes("Just a moment...") &&
		body.includes("Cloudflare Ray ID")
	);
}

export function detectCloudflareBlock(
	statusCode: number,
	body: string,
): boolean {
	return (
		statusCode === 403 &&
		body.includes("Attention Required!") &&
		body.includes("Cloudflare Ray ID")
	);
}

export async function solveCloudflareChallenge(
	url: string,
	method: "GET" | "POST",
	client: FlareSolverrClient,
	body?: Record<string, string>,
): Promise<string> {
	switch (method) {
		case "GET": {
			const response = await client.get(url);
			if (
				response.status !== "ok" &&
				response.message !== "Challenge solved!"
			) {
				throw new Error(
					`Failed to solve Cloudflare challenge: ${response.message}`,
				);
			}
			const clearance = response.solution.cookies.find((cookie) =>
				cookie.name.toLowerCase().includes("cf_clearance"),
			);
			if (!clearance) {
				throw new Error(
					"Failed to find cf_clearance cookie in FlareSolverr response.",
				);
			}
			return clearance.value;
		}
		case "POST": {
			const response = await client.post(url, body ?? {});
			if (
				response.status !== "ok" &&
				response.message !== "Challenge solved!"
			) {
				throw new Error(
					`Failed to solve Cloudflare challenge: ${response.message}`,
				);
			}
			const clearance = response.solution.cookies.find((cookie) =>
				cookie.name.toLowerCase().includes("cf_clearance"),
			);
			if (!clearance) {
				throw new Error(
					"Failed to find cf_clearance cookie in FlareSolverr response.",
				);
			}
			return clearance.value;
		}
	}
}
