// A small fixture website served on 127.0.0.1 for crawler tests: sitemap, robots, redirects, errors, private links.
import http from "node:http";

const page = (title, body, extra = "") => `<!doctype html><html lang="en"><head><title>${title}</title>
<meta name="description" content="${title} - a description long enough to pass the seventy character minimum rule ok.">
<link rel="canonical" href="CANON">${extra}</head><body>${body}</body></html>`;

export function startFixtureSite() {
  const routes = {};
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(req.url, base);
    const h = routes[url.pathname];
    if (!h) { res.writeHead(404, { "content-type": "text/html" }); return res.end("<html><body>nope</body></html>"); }
    h(req, res, base);
  });
  const html = (res, body) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(body); };

  routes["/robots.txt"] = (_q, res, base) => { res.writeHead(200, { "content-type": "text/plain" }); res.end(`User-agent: *\nDisallow: /secret\nSitemap: ${base}/sitemap.xml\n`); };
  routes["/sitemap.xml"] = (_q, res, base) => {
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(`<?xml version="1.0"?><urlset><url><loc>${base}/</loc></url><url><loc>${base}/about</loc></url><url><loc>${base}/orphan</loc></url><url><loc>${base}/gone</loc></url></urlset>`);
  };
  routes["/"] = (_q, res, base) => html(res, page("Fixture Home Page Title Example", `<h1>Fixture Home</h1>
    <p>Welcome to the fixture site about kundli matching and tarot reading. ${"Words ".repeat(320)}</p>
    <a href="/about">About us</a> <a href="/services">Services</a> <a href="/redirect">Old link</a>
    <a href="/broken">Broken</a> <a href="/secret/page">Secret</a> <a href="http://127.0.0.1:1/private">Other host</a>
    <a href="http://169.254.169.254/latest/meta-data/">metadata</a> <a href="/loop">loop</a> <a href="/big">big</a>
    <a href="/external-redirect">ext</a> <a href="/doc.pdf">pdf</a> <img src="/a.png"><img src="/b.png" alt="b">`).replace("CANON", base + "/"), base);
  routes["/about"] = (_q, res, base) => html(res, page("About the Fixture Team", `<h1>About</h1><h2>Who we are</h2><p>We have 12 years of experience and certified training. ${"More text here. ".repeat(60)}</p>
    <a href="/">Home</a><a href="/services">Services</a>`).replace("CANON", base + "/about"));
  routes["/services"] = (_q, res, base) => html(res, page("Services", `<h1>Services</h1><h1>Second H1</h1><p>Guaranteed results for your health problems. Short.</p><a href="/">Home</a>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Service","name":"x"}</script>`).replace("CANON", base + "/other-canonical"));
  routes["/orphan"] = (_q, res, base) => html(res, page("Orphan Page Nobody Links To Me", `<h1>Orphan</h1><p>${"text ".repeat(400)}</p>`).replace("CANON", base + "/orphan"));
  routes["/redirect"] = (_q, res) => { res.writeHead(301, { location: "/about" }); res.end(); };
  routes["/external-redirect"] = (_q, res) => { res.writeHead(302, { location: "http://example.com/" }); res.end(); };
  routes["/loop"] = (_q, res) => { res.writeHead(302, { location: "/loop" }); res.end(); };
  routes["/broken"] = (_q, res) => { res.writeHead(500, { "content-type": "text/html" }); res.end("<html>err</html>"); };
  routes["/gone"] = (_q, res) => { res.writeHead(410); res.end(); };
  routes["/big"] = (_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(`<html><body>${"x".repeat(3_000_000)}</body></html>`); };
  routes["/secret/page"] = (_q, res) => html(res, page("Secret", "<h1>secret</h1>"));
  routes["/noindex"] = (_q, res, base) => html(res, page("Hidden", "<h1>h</h1>", '<meta name="robots" content="noindex,follow">').replace("CANON", base + "/noindex"));

  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
    routes,
  })));
}
