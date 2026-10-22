process.env.ALLOW_PRIVATE_HOSTS = "0";
process.env.NODE_ENV = "test";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicIp, resolvePublic, assertUrlShape, SsrfError } from "../src/lib/ssrf.js";
import { normalizeUrl, sameSite, SKIP_EXT } from "../src/lib/url.js";

test("blocks loopback, private, link-local, metadata, CGNAT, multicast, reserved", () => {
  for (const ip of ["127.0.0.1", "127.9.9.9", "10.0.0.1", "172.16.5.5", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "169.254.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "240.0.0.1", "255.255.255.255", "192.0.0.1", "198.18.0.1"]) {
    assert.equal(isPublicIp(ip), false, ip);
  }
});

test("allows public IPv4", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.0.1", "100.128.0.1", "93.184.216.34"]) assert.equal(isPublicIp(ip), true, ip);
});

test("IPv6: blocks ::1, ::, ULA, link-local, multicast, mapped private; allows public", () => {
  for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.1.1.1",
    "::ffff:7f00:1", "64:ff9b::7f00:1", "2001:db8::1"]) assert.equal(isPublicIp(ip), false, ip);
  for (const ip of ["2606:4700:4700::1111", "2a00:1450:4001:80e::200e", "::ffff:8.8.8.8"]) assert.equal(isPublicIp(ip), true, ip);
});

test("resolvePublic refuses literal private IPs and localhost names", async () => {
  await assert.rejects(resolvePublic("127.0.0.1"), SsrfError);
  await assert.rejects(resolvePublic("[::1]"), SsrfError);
  await assert.rejects(resolvePublic("localhost"), SsrfError);
  await assert.rejects(resolvePublic("foo.localhost"), SsrfError);
  await assert.rejects(resolvePublic("metadata.internal"), SsrfError);
  const ok = await resolvePublic("93.184.216.34");
  assert.equal(ok[0].address, "93.184.216.34");
});

test("URL shape: scheme, credentials, port", () => {
  assert.throws(() => assertUrlShape("ftp://example.com/"), SsrfError);
  assert.throws(() => assertUrlShape("http://a:b@example.com/"), SsrfError);
  assert.throws(() => assertUrlShape("http://example.com:6379/"), SsrfError);
  assert.throws(() => assertUrlShape("http://example.com:22/"), SsrfError);
  assert.ok(assertUrlShape("https://example.com:8443/x"));
  assert.ok(assertUrlShape("http://example.com/"));
});

test("normalizeUrl: fragment, tracking params, default port, trailing slash, case", () => {
  assert.equal(normalizeUrl("HTTPS://Example.COM:443/Path/?utm_source=x&b=2&fbclid=1#top"), "https://example.com/Path?b=2");
  assert.equal(normalizeUrl("https://example.com"), "https://example.com/");
  assert.equal(normalizeUrl("https://example.com/a/b/"), "https://example.com/a/b");
  assert.equal(normalizeUrl("/rel/x", "https://example.com/base/"), "https://example.com/rel/x");
  assert.equal(normalizeUrl("mailto:x@y.z"), null);
  assert.equal(normalizeUrl("javascript:void(0)"), null);
  assert.equal(sameSite("https://www.example.com/a", "http://example.com/b"), true);
  assert.equal(sameSite("https://example.com", "https://other.com"), false);
  assert.ok(SKIP_EXT.test("https://x.com/a.PDF"));
  assert.ok(SKIP_EXT.test("https://x.com/img.png?x=1"));
  assert.ok(!SKIP_EXT.test("https://x.com/page.html"));
});
