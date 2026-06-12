export function extractNovelIdFromUrl(url: string): string | undefined {
	const match = url.match(/\/novel\/(\d+)\.html/);
	return match ? match[1] : undefined;
}

export interface NovelAndChapterIds {
	novelId: string | undefined;
	chapterId: string | undefined;
}

export function extractChapterIdFromUrl(
	url: string,
): NovelAndChapterIds | undefined {
	const match = url.match(/\/novel\/(\d+)\/(\d+)\.html/);
	if (match) {
		return {
			novelId: match[1],
			chapterId: match[2],
		};
	}
	return undefined;
}

export function transformChapterName(name: string): string {
	const chapNameTransDict: Record<string, string> = {
		"\u004e": "\u5973",
	};
	return name.replace(/./g, (char) => chapNameTransDict[char] || char);
}

export function transformContent(content: string): string {
	const contentTransDict: Record<string, string> = {
		"\u201c": "\u300c",
		"\u201d": "\u300d",
		"\u2018": "\u300e",
		"\u2019": "\u300f",
		"\ue82c": "\u7684",
		"\ue852": "\u4e00",
		"\ue82d": "\u662f",
		"\ue819": "\u4e86",
		"\ue856": "\u6211",
		"\ue857": "\u4e0d",
		"\ue816": "\u4eba",
		"\ue83c": "\u5728",
		"\ue830": "\u4ed6",
		"\ue82e": "\u6709",
		"\ue836": "\u8fd9",
		"\ue859": "\u4e2a",
		"\ue80a": "\u4e0a",
		"\ue855": "\u4eec",
		"\ue842": "\u6765",
		"\ue858": "\u5230",
		"\ue80b": "\u65f6",
		"\ue81f": "\u5927",
		"\ue84a": "\u5730",
		"\ue853": "\u4e3a",
		"\ue81e": "\u5b50",
		"\ue822": "\u4e2d",
		"\ue813": "\u4f60",
		"\ue85b": "\u8bf4",
		"\ue807": "\u751f",
		"\ue818": "\u56fd",
		"\ue810": "\u5e74",
		"\ue812": "\u7740",
		"\ue851": "\u5c31",
		"\ue801": "\u90a3",
		"\ue80c": "\u548c",
		"\ue815": "\u8981",
		"\ue84c": "\u5979",
		"\ue840": "\u51fa",
		"\ue848": "\u4e5f",
		"\ue835": "\u5f97",
		"\ue800": "\u91cc",
		"\ue826": "\u540e",
		"\ue863": "\u81ea",
		"\ue861": "\u4ee5",
		"\ue854": "\u4f1a",
		"\ue827": "\u5bb6",
		"\ue83b": "\u53ef",
		"\ue85d": "\u4e0b",
		"\ue84d": "\u800c",
		"\ue862": "\u8fc7",
		"\ue81c": "\u5929",
		"\ue81d": "\u53bb",
		"\ue860": "\u80fd",
		"\ue843": "\u5bf9",
		"\ue82f": "\u5c0f",
		"\ue802": "\u591a",
		"\ue831": "\u7136",
		"\ue84b": "\u4e8e",
		"\ue837": "\u5fc3",
		"\ue829": "\u5b66",
		"\ue85e": "\u4e48",
		"\ue83a": "\u4e4b",
		"\ue832": "\u90fd",
		"\ue808": "\u597d",
		"\ue841": "\u770b",
		"\ue821": "\u8d77",
		"\ue845": "\u53d1",
		"\ue803": "\u5f53",
		"\ue828": "\u6ca1",
		"\ue81b": "\u6210",
		"\ue83e": "\u53ea",
		"\ue820": "\u5982",
		"\ue84e": "\u4e8b",
		"\ue85a": "\u628a",
		"\ue806": "\u8fd8",
		"\ue83f": "\u7528",
		"\ue833": "\u7b2c",
		"\ue811": "\u6837",
		"\ue804": "\u9053",
		"\ue814": "\u60f3",
		"\ue80f": "\u4f5c",
		"\ue84f": "\u79cd",
		"\ue80e": "\u5f00",
		"\ue823": "\u7f8e",
		"\ue849": "\u4e73",
		"\ue805": "\u9634",
		"\ue809": "\u6db2",
		"\ue81a": "\u830e",
		"\ue844": "\u6b32",
		"\ue847": "\u547b",
		"\ue850": "\u8089",
		"\ue824": "\u4ea4",
		"\ue85f": "\u6027",
		"\ue817": "\u80f8",
		"\ue85c": "\u79c1",
		"\ue838": "\u7a74",
		"\ue82a": "\u6deb",
		"\ue83d": "\u81c0",
		"\ue82b": "\u8214",
		"\ue80d": "\u5c04",
		"\ue839": "\u8131",
		"\ue834": "\u88f8",
		"\ue846": "\u9a9a",
		"\ue825": "\u5507",
	};
	return content.replace(/./g, (char) => contentTransDict[char] || char);
}
