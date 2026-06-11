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
