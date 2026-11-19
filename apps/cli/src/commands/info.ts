import { defineCommand } from "citty";
import pc from "picocolors";
import { AcanthisApiClient } from "../client";
import { isUnresolvedChapterId, parseNovelIdOrUrl } from "../utils";
import {
	CliValidationError,
	commonApiArgs,
	resolveCommandConfig,
	writeJsonOutput,
} from "./shared";

export const infoCommand = defineCommand({
	meta: {
		name: "info",
		description:
			"Show novel metadata, 1-based volume indices, and chapter stats",
	},
	args: {
		novelIdOrUrl: {
			type: "positional",
			description: "Novel ID or URL",
			required: true,
		},
		...commonApiArgs,
	},
	async run({ args }) {
		let novelId: string;
		try {
			novelId = parseNovelIdOrUrl(
				typeof args.novelIdOrUrl === "string" ? args.novelIdOrUrl : "",
			);
		} catch (error) {
			throw new CliValidationError(
				error instanceof Error ? error.message : String(error),
				{ cause: error },
			);
		}

		const config = await resolveCommandConfig({
			server: args.server,
			source: args.source,
			token: args.token,
		});
		const client = new AcanthisApiClient(config.serverUrl, config.token);
		const novel = await client.getNovel(config.defaultSource, novelId);

		let unresolvedChapterCount = 0;
		const volumeDetails = novel.volumes.map((volume, index) => {
			const unresolvedInVolume = volume.chapters.filter((chapter) =>
				isUnresolvedChapterId(chapter.id),
			).length;
			unresolvedChapterCount += unresolvedInVolume;
			return {
				index: index + 1,
				id: volume.id,
				title: volume.title,
				chapterCount: volume.chapters.length,
				unresolvedChapterCount: unresolvedInVolume,
			};
		});

		if (args.json) {
			writeJsonOutput({
				...novel,
				unresolvedChapterCount,
			});
			return;
		}

		process.stdout.write(
			`${pc.bold(novel.title)} ${pc.cyan(`[${novel.id}]`)}\n`,
		);
		process.stdout.write(`Author:   ${novel.author}\n`);
		process.stdout.write(`Platform: ${novel.platform}\n`);
		process.stdout.write(`Status:   ${novel.status}\n`);
		if (novel.genres.length > 0) {
			process.stdout.write(`Genres:   ${novel.genres.join(", ")}\n`);
		}
		if (novel.summary.trim()) {
			process.stdout.write(`Summary:  ${novel.summary.trim()}\n`);
		}

		process.stdout.write(
			`\n${pc.bold(`Volumes (${volumeDetails.length}):`)}\n`,
		);
		for (const vol of volumeDetails) {
			const unresolvedHint =
				vol.unresolvedChapterCount > 0
					? pc.yellow(` (${vol.unresolvedChapterCount} unresolved)`)
					: "";
			process.stdout.write(
				`  ${pc.cyan(`${vol.index}.`)} ${vol.title} ${pc.dim(`[id=${vol.id}, ${vol.chapterCount} chapters]`)}${unresolvedHint}\n`,
			);
		}

		if (unresolvedChapterCount > 0) {
			process.stdout.write(
				`\n${pc.yellow(`Warning: ${unresolvedChapterCount} unresolved TOBEDETERMINED chapter(s) detected. Default export skips them; --strict aborts.`)}\n`,
			);
		}
	},
});
