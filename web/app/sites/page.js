"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, getToken } from "../../lib/api";
import { Card, Empty, PageHead, Stat } from "../../components/ui";

export default function Sites() {
  const router = useRouter();
  const [sites, setSites] = useState(null);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api("/sites").then(setSites).catch((e) => setErr(e.message));

  useEffect(() => {
    if (!getToken()) return router.push("/");
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function add(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const s = await api("/sites", { method: "POST", body: { url } });
      await api(`/sites/${s.id}/audit`, { method: "POST" });
      setUrl("");
      load();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  const list = sites || [];
  const totalIssues = list.reduce((a, s) => a + (Number(s.open_issues) || 0), 0);
  const running = list.filter((s) => ["queued", "running"].includes(s.last_run_status)).length;

  return (
    <div className="wrap page">
      <PageHead title="Your sites" desc="SEO health of all your websites at a glance." />

      <div className="stack">
        <div className="stats">
          <Stat label="Sites" value={list.length} />
          <Stat label="Open issues" value={totalIssues} tone={totalIssues ? "med" : "ok"} />
          <Stat label="Audits running" value={running} />
        </div>

        <Card title="Add a new site">
          <form className="row" onSubmit={add}>
            <input style={{ flex: 1, minWidth: 220 }} placeholder="example.com" value={url} onChange={(e) => setUrl(e.target.value)} required />
            <button disabled={busy}>{busy ? "Adding..." : "Add site & run audit"}</button>
          </form>
          {err && <div className="notice error" style={{ marginTop: 12 }}>{err}</div>}
        </Card>

        {sites === null ? (
          <div className="muted">Loading...</div>
        ) : list.length === 0 ? (
          <Card><Empty title="No sites yet">Add your first site above and the audit will start automatically.</Empty></Card>
        ) : (
          <div className="site-grid">
            {list.map((s) => (
              <Link key={s.id} href={`/sites/${s.id}`} className="card site-card">
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <div className="avatar">{s.domain[0]}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="domain">{s.domain}</div>
                    <div className="muted small">{s.gsc_property ? "Search Console linked" : "Search Console not linked"}</div>
                  </div>
                </div>
                <div className="row between" style={{ marginTop: 16 }}>
                  {s.last_run_status
                    ? <span className={`badge ${s.last_run_status}`}>Audit {s.last_run_status}</span>
                    : <span className="badge">Never audited</span>}
                  <span className="small"><b>{s.open_issues ?? "-"}</b> <span className="muted">issues</span></span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
