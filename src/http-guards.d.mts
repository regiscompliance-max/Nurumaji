export function withoutTrailingSlash(requestUrl: string): URL | null;
export function isCrossSite(requestUrl: string, originHeader: string | null, secFetchSite: string | null): boolean;
export function needsOriginCheck(method: string): boolean;
