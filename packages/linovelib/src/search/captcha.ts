import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode as decodePng } from "fast-png";
import type { InferenceSession } from "onnxruntime-node";

const MODEL_FILENAME = "captcha_cropped.onnx";
const TARGET_HEIGHT = 64;
const CHANNEL_VARIANT_NAMES = [
	"saturation",
	"maxChannel",
	"minChannel",
] as const;
const CHARSET = [
	"",
	..."0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
];

export interface SearchCaptchaLogger {
	debug: (message: string) => unknown;
}

let sessionPromise: Promise<InferenceSession> | undefined;

function moduleDirectory(): string {
	return fileURLToPath(new URL(".", import.meta.url));
}

/**
 * 模型可能出现的几个位置：
 * - 环境变量显式指定（部署时最可靠）
 * - 与当前模块同级（api-server 打包后把模型拷到 dist 目录）
 * - 包内 dist/../assets（npm 发布形态 / linovelib tsdown 产物）
 * - 包内 src/search/../../assets（workspace 内直接执行 TS 源码）
 * - 进程工作目录（Docker 镜像内 /app/captcha_cropped.onnx）
 */
function resolveModelPath(): string {
	const candidates = [
		process.env.LINOVELIB_CAPTCHA_MODEL_PATH,
		join(moduleDirectory(), MODEL_FILENAME),
		join(moduleDirectory(), "..", "assets", MODEL_FILENAME),
		join(moduleDirectory(), "..", "..", "assets", MODEL_FILENAME),
		join(process.cwd(), MODEL_FILENAME),
	].filter((candidate): candidate is string => Boolean(candidate));

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	throw new Error(
		`无法找到搜索验证码识别模型 ${MODEL_FILENAME}，尝试过的路径: ${candidates.join(", ")}`,
	);
}

async function getSession(
	logger?: SearchCaptchaLogger,
): Promise<InferenceSession> {
	if (!sessionPromise) {
		sessionPromise = (async () => {
			const loadStartAt = Date.now();
			const ort = await import("onnxruntime-node");
			// 模型输出维度声明为动态，ONNX Runtime 会为 CTC 输出发出无害的 shape 警告，这里静音。
			ort.env.logLevel = "error";
			const modelPath = resolveModelPath();
			logger?.debug(`[SearchCaptcha] 加载验证码 ONNX 模型: path=${modelPath}`);
			const model = await readFile(modelPath);
			const session = await ort.InferenceSession.create(model, {
				executionProviders: ["cpu"],
				graphOptimizationLevel: "all",
				intraOpNumThreads: 1,
				interOpNumThreads: 1,
			});
			logger?.debug(
				`[SearchCaptcha] 验证码 ONNX 模型加载完成: bytes=${model.byteLength} duration=${Date.now() - loadStartAt}ms`,
			);
			return session;
		})();
		sessionPromise.catch(() => {
			sessionPromise = undefined;
		});
	}
	return sessionPromise;
}

interface DecodedImage {
	width: number;
	height: number;
	channels: number;
	data: Uint8Array;
}

/**
 * 验证码字符使用高饱和度颜色绘制在浅色噪点背景上。
 * 直接转灰度会让部分颜色的字符与背景对比度不足，因此同时尝试多种通道变换，
 * 让模型对同一张图投票，可以明显降低误识别率。
 */
function channelVariants(image: DecodedImage): Uint8Array[] {
	const { width, height, channels, data } = image;
	const total = width * height;
	const saturation = new Uint8Array(total);
	const maxChannel = new Uint8Array(total);
	const minChannel = new Uint8Array(total);

	for (let i = 0; i < total; i++) {
		const offset = i * channels;
		const r = data[offset] ?? 0;
		const g = data[offset + 1] ?? r;
		const b = data[offset + 2] ?? g;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		saturation[i] = max - min;
		maxChannel[i] = max;
		minChannel[i] = min;
	}

	return [saturation, maxChannel, minChannel];
}

function resizeBilinear(
	source: Uint8Array,
	sourceWidth: number,
	sourceHeight: number,
	targetWidth: number,
	targetHeight: number,
): Uint8Array {
	const output = new Uint8Array(targetWidth * targetHeight);
	const scaleX = sourceWidth / targetWidth;
	const scaleY = sourceHeight / targetHeight;

	for (let y = 0; y < targetHeight; y++) {
		const sourceY = Math.min(
			sourceHeight - 1,
			Math.max(0, (y + 0.5) * scaleY - 0.5),
		);
		const y0 = Math.floor(sourceY);
		const y1 = Math.min(sourceHeight - 1, y0 + 1);
		const weightY = sourceY - y0;

		for (let x = 0; x < targetWidth; x++) {
			const sourceX = Math.min(
				sourceWidth - 1,
				Math.max(0, (x + 0.5) * scaleX - 0.5),
			);
			const x0 = Math.floor(sourceX);
			const x1 = Math.min(sourceWidth - 1, x0 + 1);
			const weightX = sourceX - x0;

			const topLeft = source[y0 * sourceWidth + x0] ?? 0;
			const topRight = source[y0 * sourceWidth + x1] ?? topLeft;
			const bottomLeft = source[y1 * sourceWidth + x0] ?? topLeft;
			const bottomRight = source[y1 * sourceWidth + x1] ?? bottomLeft;

			const top = topLeft + (topRight - topLeft) * weightX;
			const bottom = bottomLeft + (bottomRight - bottomLeft) * weightX;
			output[y * targetWidth + x] = Math.round(top + (bottom - top) * weightY);
		}
	}

	return output;
}

interface DecodedText {
	text: string;
	/** CTC 每步最大概率的平均值，用于在多个通道变体之间择优。 */
	confidence: number;
}

function decodeCtcOutput(
	data: Float32Array,
	dims: readonly number[],
): DecodedText {
	const steps = dims[0] ?? 0;
	const classes = dims[dims.length - 1] ?? 0;
	let text = "";
	let previous = -1;
	let confidenceSum = 0;

	for (let step = 0; step < steps; step++) {
		const offset = step * classes;
		let bestIndex = 0;
		let bestValue = Number.NEGATIVE_INFINITY;
		for (let index = 0; index < classes; index++) {
			const value = data[offset + index] ?? Number.NEGATIVE_INFINITY;
			if (value > bestValue) {
				bestValue = value;
				bestIndex = index;
			}
		}

		// 对当前时间步做 softmax，取最大概率作为该步置信度。
		let expSum = 0;
		for (let index = 0; index < classes; index++) {
			expSum += Math.exp((data[offset + index] ?? 0) - bestValue);
		}
		confidenceSum += expSum > 0 ? 1 / expSum : 0;

		if (bestIndex !== previous && bestIndex !== 0) {
			text += CHARSET[bestIndex] ?? "";
		}
		previous = bestIndex;
	}

	return {
		text,
		confidence: steps > 0 ? confidenceSum / steps : 0,
	};
}

function chooseBest(decoded: DecodedText[]): DecodedText {
	const fourCharacter = decoded.filter((item) => item.text.length === 4);
	if (fourCharacter.length === 0) {
		return decoded.reduce((best, item) =>
			item.confidence > best.confidence ? item : best,
		);
	}

	const votes = new Map<string, { count: number; confidence: number }>();
	for (const item of fourCharacter) {
		const current = votes.get(item.text);
		if (current) {
			current.count += 1;
			current.confidence = Math.max(current.confidence, item.confidence);
		} else {
			votes.set(item.text, { count: 1, confidence: item.confidence });
		}
	}

	let winner = fourCharacter[0] as DecodedText;
	let winnerCount = -1;
	let winnerConfidence = -1;
	for (const [text, vote] of votes) {
		if (
			vote.count > winnerCount ||
			(vote.count === winnerCount && vote.confidence > winnerConfidence)
		) {
			winner = { text, confidence: vote.confidence };
			winnerCount = vote.count;
			winnerConfidence = vote.confidence;
		}
	}
	return winner;
}

/**
 * 识别 linovelib 搜索验证码（4 位数字/字母图片）。
 * 使用 ddddocr 的 common_old 裁剪模型（MIT），见 assets/THIRD-PARTY-NOTICES.md。
 */
export async function solveCaptcha(
	image: Buffer | Uint8Array,
	logger?: SearchCaptchaLogger,
): Promise<string> {
	const startAt = Date.now();
	const decoded = decodePng(image) as unknown as DecodedImage;
	const targetWidth = Math.round(
		(decoded.width * TARGET_HEIGHT) / decoded.height,
	);
	const ort = await import("onnxruntime-node");
	const session = await getSession(logger);
	const inputName = session.inputNames[0];
	const outputName = session.outputNames[0];
	if (!inputName || !outputName) {
		throw new Error("验证码识别模型缺少输入或输出节点");
	}

	const decodedTexts: DecodedText[] = [];
	for (const variant of channelVariants(decoded)) {
		const resized = resizeBilinear(
			variant,
			decoded.width,
			decoded.height,
			targetWidth,
			TARGET_HEIGHT,
		);
		const input = new Float32Array(resized.length);
		for (let i = 0; i < resized.length; i++) {
			input[i] = (resized[i] ?? 0) / 255;
		}

		const result = await session.run({
			[inputName]: new ort.Tensor("float32", input, [
				1,
				1,
				TARGET_HEIGHT,
				targetWidth,
			]),
		});
		const output = result[outputName];
		if (!output) {
			throw new Error("验证码识别模型没有返回结果");
		}
		decodedTexts.push(
			decodeCtcOutput(
				output.data as Float32Array,
				output.dims as readonly number[],
			),
		);
	}

	if (decodedTexts.length === 0) {
		throw new Error("验证码识别失败：没有任何可用结果");
	}
	const best = chooseBest(decodedTexts);
	const variantSummary = decodedTexts
		.map(
			(item, index) =>
				`${CHANNEL_VARIANT_NAMES[index] ?? `v${index}`}=${JSON.stringify(item.text)}(${item.confidence.toFixed(3)})`,
		)
		.join(", ");
	logger?.debug(
		`[SearchCaptcha] 识别完成: winner=${JSON.stringify(best.text)}(${best.confidence.toFixed(3)}) image=${decoded.width}x${decoded.height} variants=[${variantSummary}] duration=${Date.now() - startAt}ms`,
	);
	return best.text;
}
