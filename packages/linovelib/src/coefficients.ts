import type { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import type { DescrambleCoefficients } from "@acanthis-dec/core";
import { deobfuscate } from "@acanthis-dec/deobfuscator";
import type { StorageService } from "@acanthis-dec/storage";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import * as cheerio from 'cheerio';
import { z } from "zod";

const descrambleCoefficientsSchema = z.object({
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
    return chapterLogScriptUrl;
}

export async function getCoefficientsFromPage(
	html: string,
	fetchClient: BrowserFetchClient,
	storage?: StorageService,
): Promise<DescrambleCoefficients> {
	const scriptUrl = extractChapterLogScriptUrl(html);
	if (!scriptUrl) {
		throw new Error("Chapter log script URL not found");
	}
	const version = scriptUrl.match(/chapterlog\.js\?(v.*)/)?.[1] || "";
	if (storage) {
		const cachedVersion = await storage.getCache<string>("chapterlog_js_version", z.string());
		if (version && cachedVersion === version) {
			const cachedCoefficients = await storage.getCache<DescrambleCoefficients>("coefficients", descrambleCoefficientsSchema);
			if (cachedCoefficients) {
				return cachedCoefficients;
			}
		}
	}
	const scriptContent = await fetchClient.text(scriptUrl);
	const coefficients = await extractCoefficients(scriptContent);
	if (storage) {
		await storage.setCache("chapterlog_js_version", version);
		await storage.setCache("coefficients", coefficients);
	}
	return coefficients;
}