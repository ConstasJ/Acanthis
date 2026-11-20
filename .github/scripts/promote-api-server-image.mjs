import { execFileSync } from "node:child_process";

function parseTagGroups(rawTags) {
	const groups = new Map();

	for (const rawLine of rawTags.split(/\r?\n/u)) {
		const ref = rawLine.trim();
		if (!ref) {
			continue;
		}
		const lastColon = ref.lastIndexOf(":");
		if (lastColon <= 0 || lastColon === ref.length - 1) {
			throw new Error(`Invalid image reference in TAGS: ${ref}`);
		}
		const repo = ref.slice(0, lastColon);
		const tag = ref.slice(lastColon + 1);
		if (tag.includes("/")) {
			throw new Error(`Invalid tag in image reference: ${ref}`);
		}

		let entries = groups.get(repo);
		if (!entries) {
			entries = [];
			groups.set(repo, entries);
		}
		entries.push({ repo, tag, ref });
	}

	return groups;
}

function encodeLabelArg(line) {
	const eqIndex = line.indexOf("=");
	if (eqIndex <= 0) {
		throw new Error(`Invalid label line (expected key=value): ${line}`);
	}

	const eqCount = line.split("=").length - 1;
	if (eqCount >= 2) {
		return `"${line.replaceAll('"', '""')}"`;
	}
	return line;
}

function parseLabelArgs(rawLabels) {
	const args = [];
	if (!rawLabels) {
		return args;
	}

	for (const rawLine of rawLabels.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}
		args.push("-l", encodeLabelArg(line));
	}
	return args;
}

function runCrane(args, { captureStdout = false, dryRun = false } = {}) {
	console.log(`+ crane ${args.join(" ")}`);
	if (dryRun) {
		return "";
	}
	return execFileSync("crane", args, {
		encoding: "utf8",
		stdio: ["ignore", captureStdout ? "pipe" : "inherit", "inherit"],
	});
}

function main() {
	const sourceRef = process.env.SOURCE_REF?.trim();
	const primaryRepo =
		process.env.PRIMARY_REPO?.trim() || "ghcr.io/constasj/acanthis-api-server";
	const platform = process.env.PLATFORM?.trim() || "linux/amd64";
	const rawTags = process.env.TAGS ?? "";
	const rawLabels = process.env.LABELS ?? "";
	const dryRun = process.env.DRY_RUN === "true";

	if (!sourceRef) {
		throw new Error("SOURCE_REF is required");
	}
	if (!rawTags.trim()) {
		throw new Error("TAGS is required");
	}

	const groups = parseTagGroups(rawTags);
	const primaryEntries = groups.get(primaryRepo);
	if (!primaryEntries || primaryEntries.length === 0) {
		throw new Error(`PRIMARY_REPO (${primaryRepo}) not found in TAGS`);
	}

	const labelArgs = parseLabelArgs(rawLabels);
	const [primaryFirst, ...primaryRest] = primaryEntries;

	const mutateOut = runCrane(
		[
			"mutate",
			"--platform",
			platform,
			...labelArgs,
			"-t",
			primaryFirst.ref,
			sourceRef,
		],
		{ captureStdout: true, dryRun },
	).trim();

	const promotedDigestRef = dryRun
		? `${primaryFirst.repo}@sha256:${"0".repeat(64)}`
		: mutateOut;

	if (!/^.+@sha256:[0-9a-f]{64}$/u.test(promotedDigestRef)) {
		throw new Error(
			`Unexpected crane mutate output (expected digest ref): ${promotedDigestRef}`,
		);
	}
	console.log(`Promoted primary digest: ${promotedDigestRef}`);

	for (const entry of primaryRest) {
		runCrane(["tag", promotedDigestRef, entry.tag], { dryRun });
	}

	for (const [repo, entries] of groups) {
		if (repo === primaryRepo || entries.length === 0) {
			continue;
		}
		const [first, ...rest] = entries;
		runCrane(["copy", promotedDigestRef, first.ref], { dryRun });
		for (const entry of rest) {
			runCrane(["tag", first.ref, entry.tag], { dryRun });
		}
	}
}

main();
