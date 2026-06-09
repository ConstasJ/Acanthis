export type KeywordSearch = {
    keyword: string;
    queryTime: number;
    total: number;
}

export type KeywordNovel = {
    keyword: string;
    novelId: string[];
}

export type ChapterCache = {
    id: string;
    novelId: string;
    name: string;
}

export type CoverMetadata = {
    hash: string;
    contentType: string;
    originalUrl: string;
    ext: string;
}

export type GeneralCache = {
    key: string;
    value: string;
}

export type CookieCache = {
    id: number;
    domain: string;
    path: string;
    name: string;
    value: string;
}