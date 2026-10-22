// URL normalisation shared by crawler, link graph and keyword mapping.
const TRACKING = /^(utm_\w+|fbclid|gclid|msclkid|mc_cid|mc_eid|ref|_ga|yclid|igshid)$/i;
export const SKIP_EXT = /\.(jpe?g|png|webp|gif|svg|ico|pdf|docx?|xlsx?|pptx?|zip|rar|gz|7z|mp[34]|avi|mov|wmv|css|js|json|xml|rss|atom|txt|woff2?|ttf|eot)(\?.*)?$/i;

export function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

/** host key incl. non-default port, ignoring www. */
export function siteKey(u) {
  try { const x = new URL(u); return x.hostname.toLowerCase().replace(/^www\./, "") + (x.port ? `:${x.port}` : ""); } catch { return null; }
}
export const sameSite = (a, b) => siteKey(a) !== null && siteKey(a) === siteKey(b);

/** Canonical form: lowercase host, no fragment, no default port, no tracking params, no trailing slash (except root). */
export function normalizeUrl(input, base) {
  let u;
  try { u = new URL(input, base); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k));
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);
  let path = u.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  u.pathname = path || "/";
  return u.href;
}

export function originOf(u) {
  const x = new URL(u);
  return `${x.protocol}//${x.host}`;
}

export function pathOf(u) {
  try { return new URL(u).pathname; } catch { return ""; }
}

export const PRIVATE_PATH = /\/(account|login|signin|sign-in|signup|sign-up|register|admin|dashboard|cart|checkout|api|wp-admin|wp-login\.php)(\/|$)/i;
export const isPrivatePath = (u) => PRIVATE_PATH.test(pathOf(u));
