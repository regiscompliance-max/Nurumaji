const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// One redirect removes every trailing slash and keeps the query string.
export function withoutTrailingSlash(requestUrl) {
  const url = new URL(requestUrl);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url;
  }
  return null;
}

// A browser form POST sends Origin. A cross-site request is rejected.
// Missing Origin is allowed unless the browser says the fetch is cross-site.
export function isCrossSite(requestUrl, originHeader, secFetchSite) {
  if (originHeader) {
    try {
      return new URL(originHeader).origin !== new URL(requestUrl).origin;
    } catch {
      return true;
    }
  }
  return secFetchSite === "cross-site";
}

export function needsOriginCheck(method) {
  return UNSAFE.has(method);
}
