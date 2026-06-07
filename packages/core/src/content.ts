export type ContentNode = 
    | { type: "paragraph", html: string }
    | { type: "image", src: string, alt?: string }
    | { type: "rawHtml", html: string };

export function joinChapterHtml(
    title: string | undefined,
    bodyHtml: string,
): string {
    const titleHtml = title ? `<h2>${title}</h2>` : "";
    return `${titleHtml}${bodyHtml}`;
}