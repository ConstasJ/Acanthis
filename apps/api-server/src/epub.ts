import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import type { VolumeEpubService } from "./epub/service";
import type { EpubLogger, EpubProfile } from "./epub/types";
import {
	apiErrorSchema,
	bearerSecurity,
	internalErrorResponse,
	jsonResponse,
	noStoreHeader,
	unauthorizedResponse,
	validationErrorResponse,
} from "./schemas/common";
import {
	binaryEpubResponse,
	createEpubJobBodySchema,
	epubJobParamSchema,
	epubJobResponseSchema,
	epubNovelParamSchema,
	epubProfileQuerySchema,
	epubVolumeParamSchema,
	novelEpubStatusResponseSchema,
	volumeEpubStatusResponseSchema,
} from "./schemas/epub";

export interface EpubRouteDeps {
	volumeEpubService: VolumeEpubService;
	logger: EpubLogger;
}

const INVALID_FILENAME_CHAR_SET = new Set([
	"<",
	">",
	":",
	'"',
	"/",
	"\\",
	"|",
	"?",
	"*",
]);

function sanitizeDownloadName(raw: string): string {
	let cleaned = "";
	for (let i = 0; i < raw.length; i += 1) {
		const ch = raw[i] ?? "";
		const code = raw.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f || INVALID_FILENAME_CHAR_SET.has(ch)) {
			continue;
		}
		cleaned += ch;
	}
	const normalized = cleaned
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[. ]+$/g, "");
	return normalized.length > 0 ? normalized : "acanthis-volume";
}

function encodeRfc5987Value(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

function buildContentDisposition(options: {
	novelId: string;
	volumeId: string;
	profile: EpubProfile;
	novelTitle?: string | undefined;
	volumeTitle?: string | undefined;
}): string {
	const asciiBase =
		`acanthis-${options.novelId}-${options.volumeId}-${options.profile}`
			.replace(/[^A-Za-z0-9._-]/g, "_")
			.slice(0, 120);
	const asciiFilename = `${asciiBase}.epub`;

	const displayParts = [
		options.novelTitle?.trim(),
		options.volumeTitle?.trim(),
	].filter((part): part is string => Boolean(part && part.length > 0));
	const baseDisplay =
		displayParts.length > 0
			? sanitizeDownloadName(displayParts.join(" - "))
			: asciiBase;
	const suffix = options.profile === "eink" ? " (eink)" : "";
	const utf8Filename = `${baseDisplay}${suffix}.epub`;

	return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeRfc5987Value(utf8Filename)}`;
}

function matchesIfNoneMatch(
	headerValue: string | undefined,
	etag: string,
): boolean {
	if (!headerValue) {
		return false;
	}
	const trimmed = headerValue.trim();
	if (trimmed === "*") {
		return true;
	}
	return trimmed
		.split(",")
		.map((part) => part.trim().replace(/^W\//i, ""))
		.includes(etag);
}

export function createEpubRoutes(deps: EpubRouteDeps) {
	const { volumeEpubService, logger } = deps;
	const app = new Hono();

	app.post(
		"/volumes/:novelId/:volumeId/jobs",
		describeRoute({
			tags: ["EPUB"],
			operationId: "createLinovelibVolumeEpubJob",
			summary: "创建或复用按卷 EPUB 异步构建任务",
			description:
				"触发指定小说分卷的 EPUB 构建；命中有效磁盘缓存（且未开启 refresh）时直接返回 200 与 status=ready，否则创建或复用同键活跃任务并返回 202",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(
					epubJobResponseSchema,
					"命中有效磁盘缓存，直接返回 ready 状态任务记录",
				),
				202: jsonResponse(
					epubJobResponseSchema,
					"已创建新异步任务或复用在途 Singleflight 任务",
				),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				500: internalErrorResponse,
			},
		}),
		validator("param", epubVolumeParamSchema),
		validator("json", createEpubJobBodySchema),
		async (c) => {
			try {
				const { novelId, volumeId } = c.req.valid("param");
				const { profile, refresh, triggerSource } = c.req.valid("json");
				const result = await volumeEpubService.createOrReuseJob({
					novelId,
					volumeId,
					profile,
					refresh,
					triggerSource,
				});
				return c.json(
					{
						code: 0,
						message: "Success",
						data: result.job,
					},
					result.hitCache ? 200 : 202,
				);
			} catch (error) {
				logger.error(
					`${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
				);
				return c.json(
					{
						code: 20000,
						message: "Internal Server Error",
					},
					500,
					{ "Cache-Control": "no-store" },
				);
			}
		},
	);

	app.get(
		"/jobs/:jobId",
		describeRoute({
			tags: ["EPUB"],
			operationId: "getLinovelibEpubJob",
			summary: "查询 EPUB 构建任务进度与结果",
			description:
				"根据 jobId 查询按卷 EPUB 构建任务的最新阶段、进度计数、警告与成品信息；任务不存在或已过期时返回 404",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(epubJobResponseSchema, "成功返回最新任务状态"),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				404: jsonResponse(
					apiErrorSchema,
					"任务不存在或已过期（code: 10005）",
					noStoreHeader,
				),
				500: internalErrorResponse,
			},
		}),
		validator("param", epubJobParamSchema),
		(c) => {
			try {
				const { jobId } = c.req.valid("param");
				const job = volumeEpubService.getJob(jobId);
				if (!job) {
					return c.json(
						{
							code: 10005,
							message: "EPUB job not found or expired",
						},
						404,
						{ "Cache-Control": "no-store" },
					);
				}
				return c.json({
					code: 0,
					message: "Success",
					data: job,
				});
			} catch (error) {
				logger.error(
					`${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
				);
				return c.json(
					{
						code: 20000,
						message: "Internal Server Error",
					},
					500,
					{ "Cache-Control": "no-store" },
				);
			}
		},
	);

	app.get(
		"/novels/:novelId/status",
		describeRoute({
			tags: ["EPUB"],
			operationId: "getLinovelibNovelEpubStatus",
			summary: "批量查询小说全部分卷的 EPUB 缓存与构建状态",
			description:
				"一次返回该小说所有分卷在指定 profile 下的磁盘缓存命中、内容指纹、是否过期失配（stale）、已知章节数与活跃任务 ID",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(
					novelEpubStatusResponseSchema,
					"成功返回小说全部分卷 EPUB 状态数组",
				),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				500: internalErrorResponse,
			},
		}),
		validator("param", epubNovelParamSchema),
		validator("query", epubProfileQuerySchema),
		async (c) => {
			try {
				const { novelId } = c.req.valid("param");
				const { profile } = c.req.valid("query");
				const data = await volumeEpubService.getNovelVolumesStatus(
					novelId,
					profile,
				);
				return c.json({
					code: 0,
					message: "Success",
					data,
				});
			} catch (error) {
				logger.error(
					`${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
				);
				return c.json(
					{
						code: 20000,
						message: "Internal Server Error",
					},
					500,
					{ "Cache-Control": "no-store" },
				);
			}
		},
	);

	app.get(
		"/volumes/:novelId/:volumeId/status",
		describeRoute({
			tags: ["EPUB"],
			operationId: "getLinovelibVolumeEpubStatus",
			summary: "查询单卷 EPUB 缓存与构建状态",
			description:
				"查询指定分卷在指定 profile 下的磁盘缓存命中、内容指纹、stale 标记、章节数与活跃任务 ID",
			security: bearerSecurity,
			responses: {
				200: jsonResponse(
					volumeEpubStatusResponseSchema,
					"成功返回单卷 EPUB 状态",
				),
				400: validationErrorResponse,
				401: unauthorizedResponse,
				500: internalErrorResponse,
			},
		}),
		validator("param", epubVolumeParamSchema),
		validator("query", epubProfileQuerySchema),
		async (c) => {
			try {
				const { novelId, volumeId } = c.req.valid("param");
				const { profile } = c.req.valid("query");
				const data = await volumeEpubService.getVolumeStatus(
					novelId,
					volumeId,
					profile,
				);
				return c.json({
					code: 0,
					message: "Success",
					data,
				});
			} catch (error) {
				logger.error(
					`${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
				);
				return c.json(
					{
						code: 20000,
						message: "Internal Server Error",
					},
					500,
					{ "Cache-Control": "no-store" },
				);
			}
		},
	);

	app.get(
		"/volumes/:novelId/:volumeId/download",
		describeRoute({
			tags: ["EPUB"],
			operationId: "downloadLinovelibVolumeEpub",
			summary: "流式下载已缓存的分卷 EPUB 文件",
			description:
				"校验磁盘缓存存在后流式返回 application/epub+zip，附带 ETag（支持 If-None-Match 返回 304）、Content-Length 与安全转义的 Content-Disposition；缓存不存在返回 404",
			security: bearerSecurity,
			responses: {
				200: binaryEpubResponse("成功返回分卷 EPUB 二进制流"),
				304: {
					description: "客户端 ETag 未变化，无需重新传输",
					headers: {
						ETag: {
							description: "匹配的强实体标签",
							schema: { type: "string", examples: ['"a1b2c3d4e5f60708"'] },
						},
					},
				},
				400: validationErrorResponse,
				401: unauthorizedResponse,
				404: jsonResponse(
					apiErrorSchema,
					"分卷 EPUB 磁盘缓存不存在，请先调用 POST .../jobs 构建（code: 10004）",
					noStoreHeader,
				),
				500: internalErrorResponse,
			},
		}),
		validator("param", epubVolumeParamSchema),
		validator("query", epubProfileQuerySchema),
		async (c) => {
			try {
				const { novelId, volumeId } = c.req.valid("param");
				const { profile } = c.req.valid("query");
				const artifact = await volumeEpubService.getDownloadArtifact(
					novelId,
					volumeId,
					profile,
				);
				if (!artifact) {
					return c.json(
						{
							code: 10004,
							message:
								"EPUB cache not found, please trigger POST /v1/linovelib/epub/volumes/:novelId/:volumeId/jobs first",
						},
						404,
						{ "Cache-Control": "no-store" },
					);
				}

				const etag = `"${artifact.metadata.contentFingerprint}"`;
				if (matchesIfNoneMatch(c.req.header("if-none-match"), etag)) {
					return c.body(null, 304, {
						ETag: etag,
						"Cache-Control": "private, max-age=0, must-revalidate",
					});
				}

				const contentDisposition = buildContentDisposition({
					novelId,
					volumeId,
					profile,
					novelTitle: artifact.metadata.novelTitle,
					volumeTitle: artifact.metadata.volumeTitle,
				});
				const fileStream = createReadStream(artifact.epubPath);
				const webStream = Readable.toWeb(
					fileStream,
				) as ReadableStream<Uint8Array>;

				return new Response(webStream, {
					status: 200,
					headers: {
						"Content-Type": "application/epub+zip",
						"Content-Length": String(artifact.sizeBytes),
						ETag: etag,
						"Content-Disposition": contentDisposition,
						"Cache-Control": "private, max-age=0, must-revalidate",
					},
				});
			} catch (error) {
				logger.error(
					`${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
				);
				return c.json(
					{
						code: 20000,
						message: "Internal Server Error",
					},
					500,
					{ "Cache-Control": "no-store" },
				);
			}
		},
	);

	return app;
}
