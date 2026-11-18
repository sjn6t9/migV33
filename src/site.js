// Which site this page is: the public site or the separate admin panel (admin.<domain>).
// The server writes window.__SITE__ into index.html; without it (local testing) there is one combined site.
export const SITE = (typeof window !== "undefined" && window.__SITE__) || { admin: false, main: "" };
