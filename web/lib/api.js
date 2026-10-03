const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const BASE = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
const KEY = "fixmyseo_token";
// Token cookie mein, sirf is app ke path par. Same domain ke doosre apps (jaise TrustRide)
// localStorage.clear() karein to bhi login nahi tootta, aur unke pages ise padh nahi sakte.
const COOKIE_PATH = BASE || "/";

function readCookie() {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${KEY}=`));
  return hit ? decodeURIComponent(hit.slice(KEY.length + 1)) : null;
}

function writeCookie(value, maxAge) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${KEY}=${encodeURIComponent(value)}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function getToken() {
  if (typeof window === "undefined") return null;
  const old = localStorage.getItem(KEY); // purane version ka token: cookie mein le jao
  if (old) { writeCookie(old, 7 * 86400); localStorage.removeItem(KEY); }
  return readCookie();
}
export const setToken = (t) => writeCookie(t, 7 * 86400);
export const clearToken = () => writeCookie("", 0);

// 401 par logout kyun hua, login page par dikhane ke liye
const REASON = "fixmyseo_logout_reason";
export function takeLogoutReason() {
  if (typeof window === "undefined") return "";
  const r = sessionStorage.getItem(REASON) || "";
  sessionStorage.removeItem(REASON);
  return r;
}

export async function api(path, { method = "GET", body } = {}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    clearToken();
    sessionStorage.setItem(REASON, `${path}: ${data.reason || data.error || "unauthorized"}`);
    if (window.location.pathname.replace(/\/$/, "") !== BASE) window.location.href = `${BASE}/`;
  }
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}
