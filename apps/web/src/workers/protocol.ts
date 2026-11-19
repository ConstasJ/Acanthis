import type { Novel } from "@acanthis-dec/core";

export type EpubExportStage = "chapters" | "images" | "packaging";

export interface EpubExportProgress {
	stage: EpubExportStage;
	completed: number;
	total: number;
	message: string;
}

export interface EpubWorkerRequest {
	kind: "volume" | "novel";
	apiBaseUrl: string;
	authToken: string;
	novel: Novel;
	volumeIds: string[];
	cachedChapters: Record<string, string>;
}

export type EpubWorkerResponse =
	| {
			type: "progress";
			stage: EpubExportStage;
			completed: number;
			total: number;
			message: string;
	  }
	| {
			type: "done";
			fileName: string;
			buffer: ArrayBuffer;
	  }
	| {
			type: "error";
			message: string;
	  };
