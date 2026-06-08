import { webcrack } from "webcrack";
import { detectObfuscation } from "./detector.js";

export async function deobfuscate(code: string): Promise<string> {
	let codeToDeobf = code;
	while (true) {
		const deobfCode = (await webcrack(codeToDeobf)).code;
		const detectionResult = detectObfuscation(deobfCode);
		if (detectionResult.detected) {
			codeToDeobf = deobfCode;
		} else {
			return deobfCode;
		}
	}
}
