export interface CookieCache {
    getCookies(origin: string): Promise<Record<string, string>>;
    setCookies(origin: string, cookies: Record<string, string>): Promise<void>;
    getCookie(origin: string, name: string): Promise<string | undefined>;
    setCookie(origin: string, name: string, value: string): Promise<void>;
    appendCookie(origin: string, cookies: Record<string, string>): Promise<void>;
    clearCookies(origin: string): Promise<void>;
}

export class InMemoryCookieCache implements CookieCache {
    private cache: Record<string, Record<string, string>> = {};

    async getCookies(origin: string): Promise<Record<string, string>> {
        return this.cache[origin] || {};
    }

    async setCookies(origin: string, cookies: Record<string, string>): Promise<void> {
        this.cache[origin] = cookies;
    }

    async getCookie(origin: string, name: string): Promise<string | undefined> {
        const cookies = await this.getCookies(origin);
        return cookies[name];
    }

    async setCookie(origin: string, name: string, value: string): Promise<void> {
        const cookies = await this.getCookies(origin);
        cookies[name] = value;
        await this.setCookies(origin, cookies);
    }

    async appendCookie(origin: string, cookies: Record<string, string>): Promise<void> {
        const existingCookies = await this.getCookies(origin);
        await this.setCookies(origin, { ...existingCookies, ...cookies });
    }

    async clearCookies(origin: string): Promise<void> {
        delete this.cache[origin];
    }
}