export interface CliStoredConfig {
	serverUrl?: string | undefined;
	token?: string | undefined;
	defaultSource?: string | undefined;
	outputDir?: string | undefined;
}

export interface ResolvedCliConfig {
	serverUrl: string;
	token?: string | undefined;
	defaultSource: string;
	outputDir: string;
}

export type CliConfigKey =
	| "serverUrl"
	| "token"
	| "defaultSource"
	| "outputDir";

export type ExportMode = "split" | "merged";

export interface ExportOptions {
	novelIdOrUrl: string;
	serverUrl: string;
	source: string;
	token?: string | undefined;
	outputDir: string;
	subdir?: boolean | undefined;
	mode: ExportMode;
	volumes?: string | undefined;
	illustrations: boolean;
	strict: boolean;
	overwrite: boolean;
	json: boolean;
}

export interface ExportFileResult {
	path: string;
	title: string;
	volumeId?: string | undefined;
	chapterCount: number;
	skipped: boolean;
}

export interface ExportSummary {
	novelId: string;
	novelTitle: string;
	source: string;
	mode: ExportMode;
	outputDir: string;
	files: ExportFileResult[];
	warnings: string[];
}
