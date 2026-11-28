import type { EpubImageAsset } from "@acanthis-dec/epub";

export type EpubProfile = "original" | "eink";
export type EpubTriggerSource = "reader" | "prefetch";
export type EpubJobStatus =
	| "queued"
	| "fetching_chapters"
	| "fetching_images"
	| "processing_images"
	| "packing"
	| "ready"
	| "failed";

export interface EpubJobArtifact {
	contentFingerprint: string;
	sizeBytes: number;
	chapterCount: number;
	generatedAt: string;
	downloadPath: string;
}

export interface EpubJobRecord {
	jobId: string;
	dedupeKey: string;
	platform: string;
	novelId: string;
	volumeId: string;
	profile: EpubProfile;
	triggerSource: EpubTriggerSource;
	status: EpubJobStatus;
	phaseMessage: string;
	current: number;
	total: number;
	warnings: string[];
	error?: string | undefined;
	artifact?: EpubJobArtifact | undefined;
	createdAt: number;
	updatedAt: number;
}

export interface EpubJobPatch {
	status?: EpubJobStatus | undefined;
	phaseMessage?: string | undefined;
	current?: number | undefined;
	total?: number | undefined;
	warnings?: string[] | undefined;
	error?: string | undefined;
	artifact?: EpubJobArtifact | undefined;
	updatedAt?: number | undefined;
}

export interface EpubJobStore {
	get(jobId: string): EpubJobRecord | undefined;
	findActiveByDedupeKey(dedupeKey: string): EpubJobRecord | undefined;
	create(record: EpubJobRecord): EpubJobRecord;
	update(jobId: string, patch: EpubJobPatch): EpubJobRecord | undefined;
	pruneExpired(nowMs: number): number;
}

export interface EpubCacheKey {
	platform: string;
	novelId: string;
	volumeId: string;
	profile: EpubProfile;
}

export interface EpubCacheMetadata {
	contentFingerprint: string;
	sizeBytes: number;
	chapterCount: number;
	generatedAt: string;
	lastAccessedAt: number;
	warnings: string[];
	novelTitle?: string | undefined;
	volumeTitle?: string | undefined;
	author?: string | undefined;
	chapterSignature?: string | undefined;
}

export interface EpubCachedArtifact {
	epubPath: string;
	sizeBytes: number;
	metadata: EpubCacheMetadata;
}

export interface VolumeEpubStatusItem {
	volumeId: string;
	cached: boolean;
	contentFingerprint: string | null;
	stale: boolean;
	chapterCount: number;
	sizeBytes: number | null;
	generatedAt: string | null;
	activeJobId: string | null;
}

export interface EpubImageProcessor {
	process(asset: EpubImageAsset, profile: EpubProfile): Promise<EpubImageAsset>;
}

export interface EpubLogger {
	debug: (message: string) => unknown;
	info: (message: string) => unknown;
	warn: (message: string) => unknown;
	error: (message: string) => unknown;
}

export const EPUB_CONTENT_SCHEMA_VERSION = 1;

export function isTerminalJobStatus(status: EpubJobStatus): boolean {
	return status === "ready" || status === "failed";
}

export function buildEpubDedupeKey(key: EpubCacheKey): string {
	return `${key.platform}:${key.novelId}:${key.volumeId}:${key.profile}`;
}

export function buildEpubDownloadPath(key: EpubCacheKey): string {
	return `/v1/${encodeURIComponent(key.platform)}/epub/volumes/${encodeURIComponent(key.novelId)}/${encodeURIComponent(key.volumeId)}/download?profile=${encodeURIComponent(key.profile)}`;
}
