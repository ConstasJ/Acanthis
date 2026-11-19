import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

interface ParsedCliOptions {
	version: string;
	repo: string;
	tag: string;
	checksumsPath: string;
	outDir: string;
}

interface ArchiveChecksums {
	darwinArm64: string;
	darwinX64: string;
	linuxArm64: string;
	linuxX64: string;
	windowsX64: string;
}

const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const REPO_REGEX = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA256_LINE_REGEX = /^([0-9a-fA-F]{64})\s+\*?(?:.*[/\\])?([^\s/\\]+)$/;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

function normalizeVersion(rawVersion: string): string {
	const stripped = rawVersion.trim().replace(/^v/i, "");
	if (!stripped || !SEMVER_REGEX.test(stripped)) {
		throw new Error(
			`Invalid --version "${rawVersion}": expected a semver string such as "0.1.0" or "v0.1.0".`,
		);
	}
	return stripped;
}

function normalizeRepo(rawRepo: string): string {
	const trimmed = rawRepo.trim();
	if (!REPO_REGEX.test(trimmed)) {
		throw new Error(
			`Invalid --repo "${rawRepo}": expected "owner/name" format (e.g. "ConstasJ/Acanthis").`,
		);
	}
	return trimmed;
}

function parseCliArgs(argv: readonly string[]): ParsedCliOptions {
	const { values, positionals } = parseArgs({
		args: [...argv],
		options: {
			version: { type: "string" },
			repo: { type: "string", default: "ConstasJ/Acanthis" },
			tag: { type: "string" },
			checksums: { type: "string" },
			"out-dir": { type: "string" },
		},
		allowPositionals: false,
	});

	if (positionals.length > 0) {
		throw new Error(
			`Unexpected positional arguments: ${positionals.join(", ")}`,
		);
	}

	if (!values.version) {
		throw new Error("Missing required option: --version");
	}
	if (!values.checksums) {
		throw new Error("Missing required option: --checksums");
	}
	if (!values["out-dir"]) {
		throw new Error("Missing required option: --out-dir");
	}

	const version = normalizeVersion(values.version);
	const repo = normalizeRepo(values.repo ?? "ConstasJ/Acanthis");
	const tag = values.tag?.trim() || `@acanthis-dec/cli@${version}`;

	return {
		version,
		repo,
		tag,
		checksumsPath: path.resolve(values.checksums),
		outDir: path.resolve(values["out-dir"]),
	};
}

function readAndValidateChecksums(
	checksumsPath: string,
	version: string,
): ArchiveChecksums {
	if (!fs.existsSync(checksumsPath)) {
		throw new Error(`Checksums file not found: ${checksumsPath}`);
	}

	const rawContent = fs.readFileSync(checksumsPath, "utf8");
	const byFilename = new Map<string, string>();

	const lines = rawContent.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]?.trim() ?? "";
		if (!line || line.startsWith("#")) {
			continue;
		}
		const match = SHA256_LINE_REGEX.exec(line);
		if (!match) {
			throw new Error(
				`Invalid SHA256SUMS line ${index + 1} in ${checksumsPath}: "${line}"`,
			);
		}
		const hash = match[1]?.toLowerCase();
		const filename = match[2];
		if (!hash || !SHA256_HEX_REGEX.test(hash) || !filename) {
			throw new Error(
				`Invalid SHA-256 entry on line ${index + 1} in ${checksumsPath}: "${line}"`,
			);
		}
		const existing = byFilename.get(filename);
		if (existing !== undefined && existing !== hash) {
			throw new Error(
				`Conflicting SHA-256 entries for "${filename}" in ${checksumsPath}`,
			);
		}
		byFilename.set(filename, hash);
	}

	const requiredArchive = (filename: string): string => {
		const hash = byFilename.get(filename);
		if (!hash || !SHA256_HEX_REGEX.test(hash)) {
			throw new Error(
				`Missing or invalid SHA-256 checksum for required archive "${filename}" in ${checksumsPath}`,
			);
		}
		return hash;
	};

	return {
		darwinArm64: requiredArchive(`acanthis-v${version}-darwin-arm64.tar.gz`),
		darwinX64: requiredArchive(`acanthis-v${version}-darwin-x64.tar.gz`),
		linuxArm64: requiredArchive(`acanthis-v${version}-linux-arm64.tar.gz`),
		linuxX64: requiredArchive(`acanthis-v${version}-linux-x64.tar.gz`),
		windowsX64: requiredArchive(`acanthis-v${version}-windows-x64.zip`),
	};
}

function buildReleaseBaseUrl(repo: string, tag: string): string {
	const encodedTag = encodeURIComponent(tag);
	return `https://github.com/${repo}/releases/download/${encodedTag}`;
}

function renderHomebrewFormula(
	version: string,
	repo: string,
	releaseBaseUrl: string,
	checksums: ArchiveChecksums,
): string {
	return [
		"class Acanthis < Formula",
		'  desc "Dual-mode EPUB 3.0 export CLI for Acanthis"',
		`  homepage "https://github.com/${repo}"`,
		`  version "${version}"`,
		'  license "MIT"',
		"",
		"  on_macos do",
		"    if Hardware::CPU.arm?",
		`      url "${releaseBaseUrl}/acanthis-v${version}-darwin-arm64.tar.gz"`,
		`      sha256 "${checksums.darwinArm64}"`,
		"    elsif Hardware::CPU.intel?",
		`      url "${releaseBaseUrl}/acanthis-v${version}-darwin-x64.tar.gz"`,
		`      sha256 "${checksums.darwinX64}"`,
		"    end",
		"  end",
		"",
		"  on_linux do",
		"    if Hardware::CPU.arm?",
		`      url "${releaseBaseUrl}/acanthis-v${version}-linux-arm64.tar.gz"`,
		`      sha256 "${checksums.linuxArm64}"`,
		"    elsif Hardware::CPU.intel?",
		`      url "${releaseBaseUrl}/acanthis-v${version}-linux-x64.tar.gz"`,
		`      sha256 "${checksums.linuxX64}"`,
		"    end",
		"  end",
		"",
		"  def install",
		'    bin.install "acanthis"',
		"  end",
		"",
		"  test do",
		'    assert_match version.to_s, shell_output("#{bin}/acanthis --version")',
		"  end",
		"end",
		"",
	].join("\n");
}

function renderWingetVersionManifest(version: string): string {
	return [
		"# Created using Acanthis generate-manifests.ts",
		"# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.9.0.schema.json",
		"",
		"PackageIdentifier: ConstasJ.Acanthis",
		`PackageVersion: ${version}`,
		"DefaultLocale: en-US",
		"ManifestType: version",
		"ManifestVersion: 1.9.0",
		"",
	].join("\n");
}

function renderWingetDefaultLocaleManifest(
	version: string,
	repo: string,
	tag: string,
): string {
	const [owner] = repo.split("/");
	const encodedTag = encodeURIComponent(tag);
	return [
		"# Created using Acanthis generate-manifests.ts",
		"# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.9.0.schema.json",
		"",
		"PackageIdentifier: ConstasJ.Acanthis",
		`PackageVersion: ${version}`,
		"PackageLocale: en-US",
		`Publisher: ${owner ?? "ConstasJ"}`,
		`PublisherUrl: https://github.com/${owner ?? "ConstasJ"}`,
		`PublisherSupportUrl: https://github.com/${repo}/issues`,
		"PackageName: Acanthis",
		`PackageUrl: https://github.com/${repo}`,
		"License: MIT",
		`LicenseUrl: https://github.com/${repo}/blob/master/LICENSE`,
		"ShortDescription: Dual-mode EPUB 3.0 export CLI for Acanthis",
		"Description: Dual-mode EPUB 3.0 export CLI for Acanthis that connects to an Acanthis API server to browse, search, inspect, and export light novels into standard EPUB 3.0 ebooks.",
		"Moniker: acanthis",
		"Tags:",
		"  - cli",
		"  - epub",
		"  - light-novel",
		`ReleaseNotesUrl: https://github.com/${repo}/releases/tag/${encodedTag}`,
		"ManifestType: defaultLocale",
		"ManifestVersion: 1.9.0",
		"",
	].join("\n");
}

function renderWingetZhCnLocaleManifest(
	version: string,
	repo: string,
	tag: string,
): string {
	const [owner] = repo.split("/");
	const encodedTag = encodeURIComponent(tag);
	return [
		"# Created using Acanthis generate-manifests.ts",
		"# yaml-language-server: $schema=https://aka.ms/winget-manifest.locale.1.9.0.schema.json",
		"",
		"PackageIdentifier: ConstasJ.Acanthis",
		`PackageVersion: ${version}`,
		"PackageLocale: zh-CN",
		`Publisher: ${owner ?? "ConstasJ"}`,
		`PublisherUrl: https://github.com/${owner ?? "ConstasJ"}`,
		`PublisherSupportUrl: https://github.com/${repo}/issues`,
		"PackageName: Acanthis",
		`PackageUrl: https://github.com/${repo}`,
		"License: MIT",
		`LicenseUrl: https://github.com/${repo}/blob/master/LICENSE`,
		"ShortDescription: Acanthis 双模 EPUB 3.0 导出命令行工具",
		"Description: Acanthis 双模 EPUB 3.0 导出命令行工具，连接 Acanthis API 服务端浏览、搜索、检查并将轻小说按分卷或整书合集导出为标准 EPUB 3.0 电子书。",
		`ReleaseNotesUrl: https://github.com/${repo}/releases/tag/${encodedTag}`,
		"ManifestType: locale",
		"ManifestVersion: 1.9.0",
		"",
	].join("\n");
}

function renderWingetInstallerManifest(
	version: string,
	releaseBaseUrl: string,
	windowsX64Sha: string,
): string {
	return [
		"# Created using Acanthis generate-manifests.ts",
		"# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.9.0.schema.json",
		"",
		"PackageIdentifier: ConstasJ.Acanthis",
		`PackageVersion: ${version}`,
		"InstallerType: zip",
		"NestedInstallerType: portable",
		"NestedInstallerFiles:",
		"  - RelativeFilePath: acanthis.exe",
		"    PortableCommandAlias: acanthis",
		"Installers:",
		"  - Architecture: x64",
		`    InstallerUrl: ${releaseBaseUrl}/acanthis-v${version}-windows-x64.zip`,
		`    InstallerSha256: ${windowsX64Sha}`,
		"ManifestType: installer",
		"ManifestVersion: 1.9.0",
		"",
	].join("\n");
}

function writeFileDeterministic(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf8");
}

function main(): void {
	const options = parseCliArgs(process.argv.slice(2));
	const checksums = readAndValidateChecksums(
		options.checksumsPath,
		options.version,
	);
	const releaseBaseUrl = buildReleaseBaseUrl(options.repo, options.tag);

	const formulaPath = path.join(options.outDir, "Formula", "acanthis.rb");
	const wingetDir = path.join(
		options.outDir,
		"manifests",
		"c",
		"ConstasJ",
		"Acanthis",
		options.version,
	);

	writeFileDeterministic(
		formulaPath,
		renderHomebrewFormula(
			options.version,
			options.repo,
			releaseBaseUrl,
			checksums,
		),
	);
	writeFileDeterministic(
		path.join(wingetDir, "ConstasJ.Acanthis.yaml"),
		renderWingetVersionManifest(options.version),
	);
	writeFileDeterministic(
		path.join(wingetDir, "ConstasJ.Acanthis.locale.en-US.yaml"),
		renderWingetDefaultLocaleManifest(
			options.version,
			options.repo,
			options.tag,
		),
	);
	writeFileDeterministic(
		path.join(wingetDir, "ConstasJ.Acanthis.locale.zh-CN.yaml"),
		renderWingetZhCnLocaleManifest(options.version, options.repo, options.tag),
	);
	writeFileDeterministic(
		path.join(wingetDir, "ConstasJ.Acanthis.installer.yaml"),
		renderWingetInstallerManifest(
			options.version,
			releaseBaseUrl,
			checksums.windowsX64,
		),
	);

	process.stdout.write(
		`Generated Homebrew formula (${formulaPath}) and 4 WinGet manifests (${wingetDir}).\n`,
	);
}

try {
	main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
}
