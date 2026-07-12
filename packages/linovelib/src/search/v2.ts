import type { BrowserFetchClient } from "@acanthis-dec/browser-fetch";
import { runTimeout } from "@acanthis-dec/core";

export async function refreshSearchTicket(
	fetchClient: BrowserFetchClient,
): Promise<void> {
	await fetchClient.text("https://www.linovelib.com/S6/?search_guard=css", {
		headers: {
			origin: "https://www.linovelib.com",
			referer: "https://www.linovelib.com/",
			"Sec-Fetch-Site": "same-origin",
		},
	});
	const guardJsResp = await fetchClient.text(
		"https://www.linovelib.com/S6/?search_guard=js",
		{
			headers: {
				origin: "https://www.linovelib.com",
				referer: "https://www.linovelib.com/",
				"Sec-Fetch-Site": "same-origin",
			},
		},
	);
	if (guardJsResp.mimeType !== "text/javascript") {
		throw new Error(`Unexpected response type: ${guardJsResp.mimeType}`);
	}
	const guardJsToken = guardJsResp.data.match(/jieqiSearchJs=([^;"]+)/)?.[1];
	if (!guardJsToken) {
		throw new Error(
			"Failed to extract jieqiSearchJs token from guard JS response",
		);
	}
	await fetchClient.setCookies([
		{
			name: "jieqiSearchJs",
			value: guardJsToken,
			domain: "www.linovelib.com",
			path: "/",
			maxAge: 3600,
			sameSite: "Lax",
			secure: true,
			httpOnly: true,
		},
	]);
    const request = async () => fetchClient.text(`https://www.linovelib.com/S6/?search_guard=redeem&r=${Date.now()}`, {
        headers: {
            origin: "https://www.linovelib.com",
            referer: "https://www.linovelib.com/",
            "Sec-Fetch-Site": "same-origin",
        },
    });
    await runTimeout(request, 120);
    await runTimeout(request, 800);
    await runTimeout(request, 2000);
}
