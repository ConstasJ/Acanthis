export type LcgConfig = {
	multiplier: number;
	increment: number;
	modulus: number;
};

export interface DescrambleCoefficients extends LcgConfig {
	seedMultiplier: number;
	seedOffset: number;
}

export function shuffleWithSeed(
	array: number[],
	seed: number,
	config: LcgConfig,
): number[] {
	const { multiplier, increment, modulus } = config;
	let currentSeed = seed;
	const result = [...array];
	const len = result.length;

	for (let i = len - 1; i > 0; i--) {
		currentSeed = (currentSeed * multiplier + increment) % modulus;
		const j = Math.floor((currentSeed / modulus) * (i + 1));

		// 交换
		const temp = result[i] ?? 0;
		result[i] = result[j] ?? 0;
		result[j] = temp;
	}
	return result;
}

export function buildDescrambleMapping(
	length: number,
	seed: number,
	lcg: LcgConfig,
	offset?: number,
): number[] {
	if (offset === undefined) {
		offset = 0;
	}
	const indices = Array.from({ length: length - offset }, (_, i) => i + offset);
	const shuffledIndices = shuffleWithSeed(indices, seed, lcg);
	const fullMapping = Array.from({ length: offset }, (_, i) => i).concat(
		shuffledIndices,
	);
	return fullMapping;
}

export function restoreByMapping<T>(items: T[], mapping: number[]): T[] {
	const restored = new Array(items.length);
	for (let i = 0; i < items.length; i++) {
		const targetIndex = mapping[i] ?? i;
		restored[targetIndex] = items[i];
	}
	return restored;
}
