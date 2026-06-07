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
