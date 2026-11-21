import type { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import type { DescrambleCoefficients } from "@acanthis-dec/core";
import { deobfuscate } from "@acanthis-dec/deobfuscator";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import * as t from "@babel/types";
import * as cheerio from "cheerio";
import type { Logger } from "winston";
import { z } from "zod";

type TraverseFunction = typeof traverseModule;

const traverse =
	(traverseModule as unknown as { default?: TraverseFunction }).default ??
	traverseModule;

export const descrambleCoefficientsSchema = z.object({
	modulus: z.number().int(),
	increment: z.number().int(),
	multiplier: z.number().int(),
	seedOffset: z.number().int(),
	seedMultiplier: z.number().int(),
});

function getObfuscatedPart(fullCode: string): string {
	return fullCode
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.slice(-2)
		.join("\n");
}

export async function extractCoefficients(
	script: string,
): Promise<DescrambleCoefficients> {
	const obfuscatedPart = getObfuscatedPart(script);
	const deObfCode = await deobfuscate(obfuscatedPart);
	const ast = parse(deObfCode, { sourceType: "module", plugins: ["jsx"] });
	const coefficients: Partial<DescrambleCoefficients> = {};
	traverse(ast, {
		BinaryExpression(path) {
			const { node } = path;
			if (
				node.operator === "%" &&
				t.isNumericLiteral(node.right) &&
				t.isBinaryExpression(node.left) &&
				node.left.operator === "+" &&
				t.isNumericLiteral(node.left.right) &&
				t.isBinaryExpression(node.left.left) &&
				node.left.left.operator === "*" &&
				t.isNumericLiteral(node.left.left.right)
			) {
				coefficients.modulus = node.right.value;
				const leftSide = node.left;
				if (t.isBinaryExpression(leftSide) && leftSide.operator === "+") {
					if (t.isNumericLiteral(leftSide.right)) {
						coefficients.increment = leftSide.right.value;
					}
					if (
						t.isBinaryExpression(leftSide.left) &&
						leftSide.left.operator === "*"
					) {
						if (t.isNumericLiteral(leftSide.left.right)) {
							coefficients.multiplier = leftSide.left.right.value;
						}
					}
				}
			}
			if (
				node.operator === "+" &&
				t.isNumericLiteral(node.right) &&
				t.isBinaryExpression(node.left) &&
				node.left.operator === "*" &&
				t.isNumericLiteral(node.left.right)
			) {
				const potentialOffset = node.right.value;
				const potentialMultiplier = node.left.right.value;
				const numberTransformed = node.left.left;
				if (
					t.isCallExpression(numberTransformed) &&
					t.isIdentifier(numberTransformed.callee) &&
					(numberTransformed.callee.name === "Number" ||
						numberTransformed.callee.name === "parseInt")
				) {
					coefficients.seedOffset = potentialOffset;
					coefficients.seedMultiplier = potentialMultiplier;
				}
			}
		},
	});
	if (
		coefficients.modulus === undefined ||
		coefficients.increment === undefined ||
		coefficients.multiplier === undefined ||
		coefficients.seedOffset === undefined ||
		coefficients.seedMultiplier === undefined
	) {
		throw new Error("Failed to extract all coefficients");
	}
	return coefficients as DescrambleCoefficients;
}

export function extractChapterLogScriptUrl(html: string): string {
	const $ = cheerio.load(html);
	const chapterLogScriptUrl =
		$(
			$("script")
				.toArray()
				.find((el) => {
					const scriptContent = $(el).attr("src") || "";
					return /chapterlog\.js/.test(scriptContent);
				}),
		).attr("src") || "";
	return chapterLogScriptUrl.startsWith("http")
		? chapterLogScriptUrl
		: `https://www.linovelib.com${chapterLogScriptUrl}`;
}

export interface CoefficientResult {
	coefficients: DescrambleCoefficients;
	version: string;
}

export async function getCoefficientsFromPage(
	html: string,
	fetchClient: BrowserFetchClient,
	cachedVersion?: string,
	logger?: Logger,
): Promise<CoefficientResult | undefined> {
	const scriptUrl = extractChapterLogScriptUrl(html);
	if (!scriptUrl) {
		throw new Error("Chapter log script URL not found");
	}
	const version = scriptUrl.match(/chapterlog\.js\?(v.*)/)?.[1] || "";
	if (version === cachedVersion) {
		logger?.debug(
			`[Coefficients] 命中已缓存的 chapterlog.js 版本: version=${version}`,
		);
		return undefined; // No need to fetch and extract again
	}
	const startAt = Date.now();
	logger?.debug(
		`[Coefficients] chapterlog.js 版本变化 (${cachedVersion ?? "none"} -> ${version})，开始拉取并反混淆提取系数: url=${scriptUrl}`,
	);
	const scriptContent = await fetchClient.text(scriptUrl);
	if (!scriptContent.mimeType.includes("javascript")) {
		throw new Error("Fetched content is not JavaScript");
	}
	const coefficients = await extractCoefficients(scriptContent.data);
	logger?.debug(
		`[Coefficients] 解扰系数提取完成: version=${version} duration=${Date.now() - startAt}ms`,
	);
	return {
		coefficients,
		version: version,
	};
}
