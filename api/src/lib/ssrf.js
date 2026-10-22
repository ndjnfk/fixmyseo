// SSRF guard: only public unicast IPs may be fetched. Used by the crawler and any outbound fetch of user-supplied URLs.
import dns from "node:dns/promises";
import net from "node:net";
import { config, isProd } from "../config.js";

export class SsrfError extends Error {
  constructor(msg) { super(msg); this.name = "SsrfError"; this.code = "SSRF_BLOCKED"; }
}

const v4 = (ip) => ip.split(".").map(Number);
const inV4 = (ip, base, bits) => {
  const a = v4(ip), b = v4(base);
  const toInt = (o) => ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((toInt(a) & mask) >>> 0) === ((toInt(b) & mask) >>> 0);
};

const BLOCKED_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function expandV6(ip) {
  // returns 8 hextets as numbers, handling :: and embedded IPv4
  let s = ip.toLowerCase();
  if (s.includes("%")) s = s.slice(0, s.indexOf("%"));
  const v4tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4tail) {
    const o = v4(v4tail[1]);
    s = s.slice(0, -v4tail[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const [head, tail = ""] = s.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const fill = 8 - h.length - t.length;
  const parts = [...h, ...Array(Math.max(0, fill)).fill("0"), ...t];
  return parts.map((p) => parseInt(p || "0", 16));
}

export function isPublicIp(ip) {
  if (net.isIPv4(ip)) return !BLOCKED_V4.some(([b, bits]) => inV4(ip, b, bits));
  if (!net.isIPv6(ip)) return false;
  const h = expandV6(ip);
  const all0 = h.every((x) => x === 0);
  if (all0) return false; // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return false; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    const mapped = `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
    return isPublicIp(mapped);
  }
  if (h[0] === 0x64 && h[1] === 0xff9b) { // NAT64 64:ff9b::/96
    const mapped = `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
    return isPublicIp(mapped);
  }
  if ((h[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 ULA
  if ((h[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((h[0] & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return false; // documentation
  return true;
}

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

/** Throws SsrfError if the URL may not be fetched at all (scheme, userinfo, port). */
export function assertUrlShape(u) {
  const url = typeof u === "string" ? new URL(u) : u;
  if (!["http:", "https:"].includes(url.protocol)) throw new SsrfError(`scheme not allowed: ${url.protocol}`);
  if (url.username || url.password) throw new SsrfError("credentials in URL are not allowed");
  if (!config.ALLOW_PRIVATE_HOSTS && !ALLOWED_PORTS.has(url.port)) throw new SsrfError(`port not allowed: ${url.port}`);
  return url;
}

/**
 * Resolve a hostname and verify every address is public. Returns the list of addresses (v4 first).
 * With ALLOW_PRIVATE_HOSTS=1 (never in production) the public check is skipped so tests can use 127.0.0.1.
 */
export async function resolvePublic(hostname) {
  const allowPrivate = config.ALLOW_PRIVATE_HOSTS && !isProd;
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (!allowPrivate && !isPublicIp(host)) throw new SsrfError(`address not allowed: ${host}`);
    return [{ address: host, family: net.isIPv6(host) ? 6 : 4 }];
  }
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host) && !allowPrivate) throw new SsrfError(`host not allowed: ${host}`);
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: false });
  } catch (e) {
    throw new SsrfError(`dns lookup failed for ${host}: ${e.code || e.message}`);
  }
  if (!addrs.length) throw new SsrfError(`no addresses for ${host}`);
  for (const a of addrs) {
    if (!allowPrivate && !isPublicIp(a.address)) throw new SsrfError(`host ${host} resolves to non-public address ${a.address}`);
  }
  return addrs.sort((a, b) => a.family - b.family);
}
