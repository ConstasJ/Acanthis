import z from "zod";

export const outputStyleSchema = z.enum(["acanthis", "lnreader"]);

export type OutputStyle = z.infer<typeof outputStyleSchema>;

export type ChapterItem = {
	name: string;
	path: string;
	releaseTime?: string | null | undefined;
	chapterNumber?: number | undefined;
	page?: string | undefined;
};

export interface LNReaderNovelItem {
	name: string;
	path: string;
	cover?: string | undefined;
}

export interface LNReaderNovel extends LNReaderNovelItem {
	genres?: string | undefined;
	summary?: string | undefined;
	author?: string | undefined;
	artist?: string | undefined;
	status?: string | undefined;
	rating?: number | undefined;
	chapters?: ChapterItem[];
}
