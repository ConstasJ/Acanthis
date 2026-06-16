import type { RetryContext } from "p-retry";
import { HttpStatusError, NetworkError } from "./errors";

export function isJSON(str: string): boolean {
	if (typeof str !== "string") return false;
	try {
		const result = JSON.parse(str);
		// 排除掉单纯的数字、布尔值或 null（这些也是合法的 JSON 值，但通常我们需要的是对象或数组）
		return typeof result === "object" && result !== null;
	} catch (_e) {
		return false;
	}
}

export function isFormUrlEncoded(str: string): boolean {
	if (typeof str !== "string" || str.trim() === "") return false;

	// 如果明显是 JSON 结构，直接排除
	if (str.startsWith("{") && str.endsWith("}")) return false;

	// 必须包含 '=' 符号
	if (!str.includes("=")) return false;

	try {
		const params = new URLSearchParams(str);
		let hasValidPair = false;

		for (const [key, value] of params.entries()) {
			// 如果存在键或值，且没有解析出错
			if (key !== "" || value !== "") {
				hasValidPair = true;
			}
			// 验证是否能正常 URL 解码
			decodeURIComponent(key);
			decodeURIComponent(value);
		}

		return hasValidPair;
	} catch (_e) {
		return false;
	}
}

export function isRecordStringString(
	obj: unknown,
): obj is Record<string, string> {
	// 1. 确保是对象且不是 null
	if (typeof obj !== "object" || obj === null) {
		return false;
	}

	// 2. 排除数组（因为 typeof [] 也是 'object'，但它通常不符合 Record 的业务预期）
	if (Array.isArray(obj)) {
		return false;
	}

	// 3. 检查是否存在 Symbol 类型的 Key（Record<string, string> 显式要求键为 string）
	if (Object.getOwnPropertySymbols(obj).length > 0) {
		return false;
	}

	// 4. 遍历检查所有的 Value 是否为字符串
	// 使用 Object.values 可以同时覆盖普通属性和不可枚举属性（如果用 Object.keys）
	// 这里使用最稳妥的 Object.keys 或 Reflect.ownKeys（已排除Symbol）来检查
	const keys = Object.keys(obj);
	for (const key of keys) {
		if (typeof (obj as Record<string, unknown>)[key] !== "string") {
			return false;
		}
	}

	return true;
}

export type WWWFormUrlEncodedBody =
	| Record<string, string>
	| URLSearchParams
	| string
	| FormData;

export function iswwwFormUrlEncoded(
	body: unknown,
): body is WWWFormUrlEncodedBody {
	if (typeof body === "string") {
		return isFormUrlEncoded(body);
	} else if (body instanceof URLSearchParams || body instanceof FormData) {
		return true;
	} else if (typeof body === "object" && body !== null) {
		return isRecordStringString(body);
	}
	return false;
}

export function wwwFormUrlEncodedToRecordStringString(
	body: WWWFormUrlEncodedBody,
): Record<string, string> {
	if (typeof body === "string") {
		const params = new URLSearchParams(body);
		const result: Record<string, string> = {};
		for (const [key, value] of params.entries()) {
			result[key] = value;
		}
		return result;
	} else if (body instanceof URLSearchParams) {
		const result: Record<string, string> = {};
		for (const [key, value] of body.entries()) {
			result[key] = value;
		}
		return result;
	} else if (body instanceof FormData) {
		const result: Record<string, string> = {};
		for (const [key, value] of body.entries()) {
			if (typeof value === "string") {
				result[key] = value;
			} else {
				throw new Error(
					"FormData values must be strings to convert to Record<string, string>",
				);
			}
		}
		return result;
	} else if (typeof body === "object" && body !== null) {
		return body as Record<string, string>;
	} else {
		throw new Error("Unsupported body type for www-form-urlencoded conversion");
	}
}

export type ContentTypeInfo = {
	mimeType: string;
	isText: boolean;
	charset?: BufferEncoding | undefined;
};

export function isBufferEncoding(encoding: string): encoding is BufferEncoding {
	const validEncodings: BufferEncoding[] = [
		"ascii",
		"utf8",
		"utf-8",
		"utf16le",
		"ucs2",
		"base64",
		"latin1",
		"binary",
		"hex",
	];
	return validEncodings.includes(encoding as BufferEncoding);
}

export function extractContentType(contetType: string): ContentTypeInfo {
	const [mimeType, ...params] = contetType
		.split(";")
		.map((part) => part.trim());
	const isText =
		/^(text\/(html|plain|css|javascript)|application\/(json|xml|javascript))(;\s*charset=[a-zA-Z0-9_-]+)?$/.test(
			contetType,
		);
	const charsetParam = params.find((param) =>
		param.toLowerCase().startsWith("charset="),
	);
	const charsetString = charsetParam
		? charsetParam.split("=")[1]?.trim()
		: undefined;
	const charset = charsetString
		? isBufferEncoding(charsetString)
			? charsetString
			: undefined
		: undefined;

	return {
		mimeType: mimeType ?? "application/octet-stream",
		isText,
		charset: charset ?? (isText ? "utf-8" : undefined),
	};
}

export function defaultRetryPolicy(ctx: RetryContext): boolean {
	// By default, retry on network errors and 5xx HTTP errors
	const error = ctx.error;
	if (error instanceof NetworkError) {
		return true;
	}
	if (error instanceof HttpStatusError) {
		return error.status >= 500 && error.status < 600;
	}
	return false;
}
