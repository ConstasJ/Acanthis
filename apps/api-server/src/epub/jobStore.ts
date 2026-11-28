import {
	type EpubJobPatch,
	type EpubJobRecord,
	type EpubJobStore,
	isTerminalJobStatus,
} from "./types";

export interface InMemoryEpubJobStoreOptions {
	jobTtlMs: number;
}

function cloneJobRecord(record: EpubJobRecord): EpubJobRecord {
	const cloned: EpubJobRecord = {
		...record,
		warnings: [...record.warnings],
	};
	if (record.artifact !== undefined) {
		cloned.artifact = { ...record.artifact };
	}
	return cloned;
}

export class InMemoryEpubJobStore implements EpubJobStore {
	private readonly jobTtlMs: number;
	private readonly jobs = new Map<string, EpubJobRecord>();
	private readonly activeByDedupeKey = new Map<string, string>();

	constructor(options: InMemoryEpubJobStoreOptions) {
		this.jobTtlMs = Math.max(1, Math.floor(options.jobTtlMs));
	}

	get(jobId: string): EpubJobRecord | undefined {
		const record = this.jobs.get(jobId);
		return record ? cloneJobRecord(record) : undefined;
	}

	findActiveByDedupeKey(dedupeKey: string): EpubJobRecord | undefined {
		const activeJobId = this.activeByDedupeKey.get(dedupeKey);
		if (!activeJobId) {
			return undefined;
		}
		const record = this.jobs.get(activeJobId);
		if (!record || isTerminalJobStatus(record.status)) {
			this.activeByDedupeKey.delete(dedupeKey);
			return undefined;
		}
		return cloneJobRecord(record);
	}

	create(record: EpubJobRecord): EpubJobRecord {
		const stored = cloneJobRecord(record);
		this.jobs.set(stored.jobId, stored);
		if (!isTerminalJobStatus(stored.status)) {
			this.activeByDedupeKey.set(stored.dedupeKey, stored.jobId);
		}
		return cloneJobRecord(stored);
	}

	update(jobId: string, patch: EpubJobPatch): EpubJobRecord | undefined {
		const existing = this.jobs.get(jobId);
		if (!existing) {
			return undefined;
		}

		const next: EpubJobRecord = {
			...existing,
			updatedAt: patch.updatedAt ?? Date.now(),
		};

		if (patch.status !== undefined) {
			next.status = patch.status;
		}
		if (patch.phaseMessage !== undefined) {
			next.phaseMessage = patch.phaseMessage;
		}
		if (patch.current !== undefined) {
			next.current = patch.current;
		}
		if (patch.total !== undefined) {
			next.total = patch.total;
		}
		if (patch.warnings !== undefined) {
			next.warnings = [...patch.warnings];
		}
		if (patch.error !== undefined) {
			next.error = patch.error;
		}
		if (patch.artifact !== undefined) {
			next.artifact = { ...patch.artifact };
		}

		this.jobs.set(jobId, next);

		if (isTerminalJobStatus(next.status)) {
			if (this.activeByDedupeKey.get(next.dedupeKey) === jobId) {
				this.activeByDedupeKey.delete(next.dedupeKey);
			}
		} else {
			this.activeByDedupeKey.set(next.dedupeKey, jobId);
		}

		return cloneJobRecord(next);
	}

	pruneExpired(nowMs: number = Date.now()): number {
		let prunedCount = 0;
		for (const [jobId, record] of this.jobs.entries()) {
			if (!isTerminalJobStatus(record.status)) {
				continue;
			}
			if (nowMs - record.updatedAt >= this.jobTtlMs) {
				this.jobs.delete(jobId);
				if (this.activeByDedupeKey.get(record.dedupeKey) === jobId) {
					this.activeByDedupeKey.delete(record.dedupeKey);
				}
				prunedCount += 1;
			}
		}
		return prunedCount;
	}
}
