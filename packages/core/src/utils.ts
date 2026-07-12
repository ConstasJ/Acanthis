const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runTimeout<T>(
	callback: () => T | Promise<T>,
	delayTime: number,
): Promise<T> {
	await sleep(delayTime);
	return await callback();
}
