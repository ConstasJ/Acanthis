import type {
	ExploreSchema,
	ExploreSectionMoreTarget,
	NovelStatus,
} from "@acanthis-dec/core";
import { ApiError } from "@/api/client";

export type ExploreTab = "home" | "rankings" | "catalog" | "cached";

export function isChallengeBlockedError(error: unknown): boolean {
	return (
		error instanceof ApiError &&
		(error.status === 503 || error.code === 20001 || error.code === 20002)
	);
}

export function formatApiErrorMessage(
	error: unknown,
	fallback: string,
): string {
	if (error instanceof ApiError) {
		return error.message;
	}
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}
	return fallback;
}

export function formatNovelStatusLabel(
	status: NovelStatus | undefined,
): string | null {
	if (status === "completed") {
		return "已完结";
	}
	if (status === "ongoing") {
		return "连载中";
	}
	return null;
}

export function resolveDefaultHomeChannel(schema: ExploreSchema): string {
	if (schema.channels.some((c) => c.id === "home")) {
		return "home";
	}
	const nonChallenge = schema.channels.find((c) => !c.requiresChallenge);
	if (nonChallenge) {
		return nonChallenge.id;
	}
	return schema.channels[0]?.id ?? "home";
}

export function resolveRankingSelection(
	schema: ExploreSchema,
	requestedRank: string,
	requestedFull: boolean,
): { rank: string; full: boolean } {
	const rankings = schema.rankings;
	if (rankings.length === 0) {
		return { rank: requestedRank, full: requestedFull };
	}

	let resolvedFull = requestedFull;
	let candidates = rankings.filter((r) =>
		resolvedFull ? r.supportsFull : r.supportsAll,
	);
	if (candidates.length === 0) {
		resolvedFull = !resolvedFull;
		candidates = rankings.filter((r) =>
			resolvedFull ? r.supportsFull : r.supportsAll,
		);
	}

	if (candidates.length === 0) {
		return {
			rank: rankings[0]?.id ?? requestedRank,
			full: requestedFull,
		};
	}

	const matched = candidates.find(
		(r) => r.id === requestedRank && (resolvedFull || r.id !== "allvisit"),
	);
	return {
		rank: matched?.id ?? candidates[0]?.id ?? requestedRank,
		full: resolvedFull,
	};
}

export function parsePositivePage(raw: unknown): number {
	const num = Number(raw);
	if (!Number.isFinite(num) || num < 1) {
		return 1;
	}
	return Math.floor(num);
}

export type MoreNavigationTarget = ExploreSectionMoreTarget;
