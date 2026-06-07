export type AutoSolvePolicy = "auto" | "force-refresh" | "never";

export type AutoSolveDetectorType = "cloudflare" | "custom";

export type CustomChallengeDetector = (
	statusCode: number,
	body: string,
) => boolean;

export type ChallengeOptions = {
	autoSolve: AutoSolvePolicy;
	detector: AutoSolveDetectorType;
	customDetector?: CustomChallengeDetector;
};

export function cloudflareDetector(statusCode: number, body: string): boolean {
	return (
		statusCode === 503 && /Attention Required|Cloudflare Ray ID/.test(body)
	);
}
