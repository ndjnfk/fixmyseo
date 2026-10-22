const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const BASE = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
const KEY = "fixmyseo_token";
const ORG = "fixmyseo_org";
// Token cookie mein, sirf is app ke path par. Same domain ke doosre apps localStorage.clear() karein to bhi login nahi tootta.
const COOKIE_PATH = BASE || "/";

function readCookie(name) {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

function writeCookie(name, value, maxAge) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function getToken() {
  if (typeof window === "undefined") return null;
  const old = localStorage.getItem(KEY);
  if (old) { writeCookie(KEY, old, 7 * 86400); localStorage.removeItem(KEY); }
  return readCookie(KEY);
}
export const setToken = (t) => writeCookie(KEY, t, 7 * 86400);
export const clearToken = () => { writeCookie(KEY, "", 0); writeCookie(ORG, "", 0); };
export const getOrg = () => (typeof window === "undefined" ? null : readCookie(ORG));
export const setOrg = (id) => writeCookie(ORG, String(id), 30 * 86400);

const REASON = "fixmyseo_logout_reason";
export function takeLogoutReason() {
  if (typeof window === "undefined") return "";
  const r = sessionStorage.getItem(REASON) || "";
  sessionStorage.removeItem(REASON);
  return r;
}

export async function api(path, { method = "GET", body } = {}) {
  const token = getToken();
  const org = getOrg();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(org ? { "x-org-id": org } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    clearToken();
    sessionStorage.setItem(REASON, `${path}: ${data.reason || data.error || "unauthorized"}`);
    if (window.location.pathname.replace(/\/$/, "") !== BASE) window.location.href = `${BASE}/`;
  }
  if (res.status === 403 && org && /not a member/.test(data.reason || "")) {
    writeCookie(ORG, "", 0); // stale org selection: fall back to the default org
    window.location.reload();
  }
  if (!res.ok) {
    const e = new Error(data.error || `request failed (${res.status})`);
    e.status = res.status; e.data = data;
    throw e;
  }
  return data;
}

/** Poll a background job until it finishes. onTick(job) is called on every poll. */
export async function pollJob(jobId, { onTick, intervalMs = 2000, timeoutMs = 20 * 60 * 1000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const job = await api(`/jobs/${jobId}`);
    onTick?.(job);
    if (job.status === "done") return job;
    if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error || `job ${job.status}`);
    await new Promise((ok) => setTimeout(ok, intervalMs));
  }
  throw new Error("job timed out");
}

export const when = (t) => (t ? new Date(t).toLocaleString() : "-");
