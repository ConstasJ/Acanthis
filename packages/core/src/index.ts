import type { DescrambleCoefficients, LcgConfig } from "./descramble.js";
import { buildDescrambleMapping, restoreByMapping } from "./descramble.js";
import type {
	Chapter,
	ChapterContent,
	Novel,
	NovelStatus,
	Volume,
} from "./types.js";

export type {
	Chapter,
	ChapterContent,
	DescrambleCoefficients,
	LcgConfig,
	Novel,
	NovelStatus,
	Volume,
};

export { buildDescrambleMapping, restoreByMapping };
