import type z from "zod";

export class BrowserFetchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BrowserFetchError";
	}
}

export class HttpStatusError extends BrowserFetchError {
	public status: number;
	public url: string;
	public responseText: string;

	constructor(status: number, url: string, responseText: string) {
		super(`HTTP error ${status} for ${url}`);
		this.name = "HttpStatusError";
		this.status = status;
		this.url = url;
		this.responseText = responseText;
	}
}

export class CloudflareBlockError extends BrowserFetchError {
	public url: string;

	constructor(url: string) {
		super(`Cloudflare block detected for ${url}`);
		this.name = "CloudflareBlockError";
		this.url = url;
	}
}

export class NetworkError extends BrowserFetchError {
	public url: string;

	constructor(url: string, message: string) {
		super(`Network error for ${url}: ${message}`);
		this.name = "NetworkError";
		this.url = url;
	}
}

export class FlareSolverrError extends BrowserFetchError {
	public endpoint: string;
	public responseText: string;

	constructor(endpoint: string, responseText: string) {
		super(`FlareSolver error for ${endpoint}: ${responseText}`);
		this.name = "FlareSolverError";
		this.endpoint = endpoint;
		this.responseText = responseText;
	}
}

export class JSONParseError extends BrowserFetchError {
	public url: string;
	public responseText: string;
	cause?: Error | undefined;

	constructor(url: string, responseText: string, cause?: Error) {
		super(`Failed to parse JSON response from ${url}`);
		this.name = "JSONParseError";
		this.url = url;
		this.responseText = responseText;
		this.cause = cause;
	}
}

export class SchemaValidationError extends BrowserFetchError {
	public url: string;
	public responseText: string;
	public validationErrors: z.core.$ZodIssue[];

	constructor(
		url: string,
		responseText: string,
		validationErrors: z.core.$ZodIssue[],
	) {
		super(`Response from ${url} failed schema validation`);
		this.name = "SchemaValidationError";
		this.url = url;
		this.responseText = responseText;
		this.validationErrors = validationErrors;
	}
}

export class TypeNotMatchError extends BrowserFetchError {
	public url: string;
	public expectedType: string;
	public actualType: string;

	constructor(url: string, expectedType: string, actualType: string) {
		super(
			`Expected response type ${expectedType} but got ${actualType} for ${url}`,
		);
		this.name = "TypeNotMatchError";
		this.url = url;
		this.expectedType = expectedType;
		this.actualType = actualType;
	}
}
