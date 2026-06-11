import { webcrack } from "webcrack";
import { detectObfuscation } from "./detector";

export async function deobfuscate(code: string): Promise<string> {
	let codeToDeobf = code;
	while (true) {
		const detectResult = detectObfuscation(codeToDeobf);
		if (!detectResult.detected) {
			return codeToDeobf;
		}
		const deobfCode = (await webcrack(codeToDeobf)).code;
		codeToDeobf = deobfCode;
	}
}
