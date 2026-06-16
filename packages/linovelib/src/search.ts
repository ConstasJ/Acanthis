import { webcrypto } from "node:crypto";
import type { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import type { NovelSearchResult } from "@acanthis-dec/core";
import * as cheerio from "cheerio";
import { extractNovelIdFromUrl } from "./utils";

function k(e: string): Uint8Array<ArrayBuffer> {
	// 标准 Base64 映射表
	const t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

	// 1. 过滤掉所有不在映射表中的字符 (对应原代码的正则)
	const n = e.replace(/[^A-Za-z0-9+/]/g, "");
	const r = n.length;

	// 2. 计算输出长度：每 4 个字符转为 3 个字节
	// 注意：原代码通常不处理末尾填充，直接通过位移计算
	const buf = new Uint8Array(Math.floor(r * 0.75));
	let i = 0, // buf 指针
		a = 0, // 累加器
		s = 0, // 当前位深
		c = 0; // 临时索引
	for (let l = 0; l < r; l++) {
		c = t.indexOf(n[l] || "");
		if (c === -1) continue; // 安全检查
		a = (a << 6) | c; // 每个 Base64 字符携带 6 位信息
		s += 6;
		if (s >= 8) {
			s -= 8;
			// 提取高 8 位存入字节数组
			buf[i++] = (a >> s) & 255;
		}
	}
	// 关键：必须截取到实际写入的长度
	// 并强制转换为 Uint8Array<ArrayBuffer>
	return new Uint8Array(buf.buffer.slice(0, i)) as Uint8Array<ArrayBuffer>;
}

async function solveSearchChallenge(
	a: string,
	b: string,
	c: string,
): Promise<string> {
	const subtle = webcrypto.subtle;
	// 使用 as Uint8Array 明确告诉 TS 这是它需要的 BufferSource
	const keyData = k(a);
	const counterData = k(b);
	const encryptedData = k(c);
	try {
		const cryptoKey = await subtle.importKey(
			"raw",
			keyData,
			{ name: "AES-CTR" },
			false,
			["decrypt"],
		);
		const decryptedBuffer = await subtle.decrypt(
			{
				name: "AES-CTR",
				counter: counterData,
				length: 64,
			},
			cryptoKey,
			encryptedData,
		);
		// decryptedBuffer 得到的是 ArrayBuffer，需要转回 Uint8Array 供 TextDecoder 使用
		const decoder = new TextDecoder();
		const plainText = decoder.decode(new Uint8Array(decryptedBuffer));
		return encodeURIComponent(plainText);
	} catch (error) {
		throw new Error(`解密失败: ${error}`);
	}
}

export async function searchNovels(
	keyword: string,
	fetchClient: BrowserFetchClient,
): Promise<NovelSearchResult[]> {
	let response = await fetchClient.text("https://www.linovelib.com/S6/", {
		method: "POST",
		body: new URLSearchParams({
			searchkey: keyword,
		}),
		headers: {
			origin: "https://www.linovelib.com",
			referer: "https://www.linovelib.com/",
		},
	});
	if (response.mimeType !== "text/html") {
		throw new Error(`Unexpected response type: ${response.mimeType}`);
	}
	let $ = cheerio.load(response.data);
	if ($("#challenge-running").length > 0) {
		let a = "",
			b = "",
			c = "";
		$("script").each((_, el) => {
			const scriptContent = $(el).html() || "";
			if (/window\.a\s*=\s*'([^']+)'/.test(scriptContent)) {
				a = scriptContent.match(/window\.a\s*=\s*'([^']+)'/)?.[1] || "";
				b = scriptContent.match(/window\.b\s*=\s*'([^']+)'/)?.[1] || "";
				c = scriptContent.match(/window\.c\s*=\s*'([^']+)'/)?.[1] || "";
			}
		});
		const haha = await solveSearchChallenge(a, b, c);
		await new Promise((r) => setTimeout(r, 3000));
		response = await fetchClient.text("https://www.linovelib.com/S6/", {
			method: "POST",
			body: new URLSearchParams({
				searchkey: keyword,
			}),
			cookies: {
				haha,
			},
			headers: {
				origin: "https://www.linovelib.com",
				referer: "https://www.linovelib.com/S6/",
			},
		});
		$ = cheerio.load(response.data);
	}
	if ($("#challenge-running").length !== 0) {
		throw new Error("Failed to solve search challenge");
	}
	if ($("div.book-html-box").length > 0) {
		return [
			{
				title: $("h1.book-name").text().trim(),
				platform: "linovelib",
				id:
					extractNovelIdFromUrl($("meta[name=url]").attr("content") ?? "") ||
					"",
				coverUrl: $("div.book-img img").attr("src") || "",
			},
		];
	}
	if (!response.data.includes("有关")) {
		throw new Error("Unexpected search result format, keyword not found");
	}
	const pages =
		$("em#pagestats")
			.text()
			.match(/1\/(\d+)/)?.[1] || "1";
	const results: NovelSearchResult[] = [];
	$("div.search-html-box div.search-result-list").each((_, el) => {
		const $el = $(el);
		const title = $el.find("h2").text().trim();
		const url = $el.find("h2 a").attr("href") || "";
		const id = extractNovelIdFromUrl(url) ?? "";
		const coverUrl = $el.find("img").attr("src") || "";
		results.push({
			title,
			platform: "linovelib",
			id,
			coverUrl,
		});
	});
	if (Number(pages) > 1) {
		let currentPageHtml = response.data;
		while (true) {
			const $2 = cheerio.load(currentPageHtml);
			if ($2("a.next").length > 0) {
				currentPageHtml = (
					await fetchClient.text(
						`https://www.linovelib.com${$2("a.next").attr("href")}`,
					)
				).data;
			}
			const $3 = cheerio.load(currentPageHtml);
			$3("div.search-html-box div.search-result-list").each((_, el) => {
				const $el = $3(el);
				const title = $el.find("h2").text().trim();
				const url = $el.find("h2 a").attr("href") || "";
				const id = extractNovelIdFromUrl(url) ?? "";
				const coverUrl = $el.find("img").attr("src") || "";
				results.push({
					title,
					platform: "linovelib",
					id,
					coverUrl,
				});
			});
			if ($3("a.next").length === 0) break;
		}
	}
	return results;
}
