"use client";
import { useEffect, useState } from "react";
import { api, pollJob } from "../../../../lib/api";
import { Card, Empty, Stat } from "../../../../components/ui";
import { useSite } from "../SiteContext";

const n = (v) => Number(v).toLocaleString();

function QueryTable({ title, desc, rows, label }) {
  return (
    <Card title={title} flush>
      {desc && <p className="muted small" style={{ margin: "4px 20px 0" }}>{desc}</p>}
      {rows.length === 0 ? <Empty>No data</Empty> : (
        <div className="table-wrap scroll" style={{ marginTop: 14, maxHeight: 420 }}>
          <table>
            <thead><tr><th>{label}</th><th>Clicks</th><th>Impr.</th><th>Avg pos</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k}><td>{r.k}</td><td>{n(r.clicks)}</td><td>{n(r.impressions)}</td><td>{r.position}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function SearchConsole() {
  const { id: siteId, data, isAdmin, canEdit } = useSite();
  const property = data.site.gsc_property;
  const [status, setStatus] = useState(null);
  const [props, setProps] = useState([]);
  const [sel, setSel] = useState("");
  const [sum, setSum] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const loadSummary = () => api(`/sites/${siteId}/gsc/summary`).then(setSum).catch((e) => setErr(e.message));

  useEffect(() => {
    api("/google/status").then((s) => {
      setStatus(s);
      if (s.connected && !property && isAdmin) {
        api("/google/properties").then((p) => { setProps(p); setSel(p[0]?.property || ""); }).catch((e) => setErr(e.message));
      }
    }).catch((e) => setErr(e.message));
    if (property) loadSummary();
  }, [siteId, property]);

  async function connect() {
    try { const { url } = await api(`/google/auth-url?site=${siteId}`); window.location.href = url; }
    catch (e) { setErr(e.message); }
  }
  async function link() {
    setErr(""); setBusy("link");
    try { await api(`/sites/${siteId}/gsc`, { method: "POST", body: { property: sel } }); window.location.reload(); }
    catch (e) { setErr(e.message); setBusy(""); }
  }
  async function disconnect() {
    if (!confirm("Disconnect Google? This deletes all synced Search Console data for your organization.")) return;
    setErr(""); setBusy("disc");
    try { await api("/google/connection", { method: "DELETE" }); window.location.reload(); }
    catch (e) { setErr(e.message); setBusy(""); }
  }
  async function sync() {
    setErr(""); setBusy("Queued...");
    try {
      const r = await api(`/sites/${siteId}/gsc/sync`, { method: "POST" });
      await pollJob(r.job_id, { onTick: (j) => setBusy(`Sync ${j.status}...`) });
      await loadSummary();
    } catch (e) { setErr(e.message); }
    setBusy("");
  }

  if (!status) return err ? <div className="notice error">{err}</div> : <span className="muted">Loading...</span>;

  if (!status.configured)
    return <Card title="Google Search Console"><div className="notice warn">Google integration is not configured yet. Missing in the server <code>.env</code>:{" "}
      {(status.missing?.length ? status.missing : ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ENC_KEY (64 characters)"]).map((m, i) => <span key={m}>{i > 0 && ", "}<code>{m}</code></span>)}. Then restart the API.</div></Card>;

  if (!status.plan_allows)
    return <Card title="Google Search Console"><div className="notice warn">Search Console is not included in your current plan. See <a href="/billing">Plan &amp; usage</a>.</div></Card>;

  if (!status.connected)
    return (
      <Card title="Google Search Console" actions={isAdmin && <button onClick={connect}>Connect Google</button>}>
        <p className="muted" style={{ margin: 0 }}>Connect your Google account to see real queries, clicks and positions (observed data, not estimates), and to let FixMySEO submit your sitemap and check indexing. You can disconnect at any time.</p>
        {!isAdmin && <p className="muted small">An admin must connect Google.</p>}
        {err && <div className="notice error" style={{ marginTop: 12 }}>{err}</div>}
      </Card>
    );

  if (!property)
    return (
      <Card title="Link a property">
        <p className="muted" style={{ marginTop: 0 }}>Connected: <b>{status.email}</b>. Choose the Search Console property for this site:</p>
        <div className="row">
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ width: "auto", minWidth: 260 }}>
            {props.map((p) => <option key={p.property} value={p.property}>{p.property}</option>)}
          </select>
          <button onClick={link} disabled={Boolean(busy) || !sel || !isAdmin}>Link property</button>
          {isAdmin && <button className="ghost" onClick={disconnect} disabled={Boolean(busy)}>Disconnect Google</button>}
        </div>
        {props.length === 0 && <p className="muted">No verified properties found.</p>}
        {err && <div className="notice error" style={{ marginTop: 12 }}>{err}</div>}
      </Card>
    );

  const t = sum?.totals;
  return (
    <div className="stack">
      <Card title={property} actions={
        <>
          {isAdmin && <button className="ghost" onClick={disconnect} disabled={Boolean(busy)}>Disconnect</button>}
          {canEdit && <button onClick={sync} disabled={Boolean(busy)}>{busy || "Sync now (90 days)"}</button>}
        </>
      }>
        <div className="muted small">
          {sum?.last_sync ? `Last sync: ${new Date(sum.last_sync).toLocaleString()}` : "Not synced yet"} · auto sync daily · {status.email} · source: Google Search Console (observed)
        </div>
        {(err || sum?.sync_error) && <div className="notice error" style={{ marginTop: 12 }}>{err || sum.sync_error}</div>}
        {!status.can_submit && isAdmin && (
          <div className="notice warn" style={{ marginTop: 12 }}>
            Sitemap auto-submit needs an extra permission. <a href="#" onClick={(e) => { e.preventDefault(); connect(); }}>Reconnect Google</a>
          </div>
        )}
      </Card>

      {sum && sum.daily.length === 0 && <Card><Empty title="No data yet">New or low-traffic sites may show no data for the first few days.</Empty></Card>}

      {sum && sum.daily.length > 0 && (
        <>
          <div className="stats">
            <Stat label="Clicks (28d)" value={n(t.clicks)} />
            <Stat label="Impressions (28d)" value={n(t.impressions)} />
            <Stat label="CTR" value={`${t.impressions ? ((t.clicks / t.impressions) * 100).toFixed(1) : 0}%`} />
          </div>
          <QueryTable title="Quick wins" desc="Queries ranking in positions 4-20. A small push can move them to the top of page 1." rows={sum.opportunities} label="Query" />
          <div className="grid2" style={{ alignItems: "start" }}>
            <QueryTable title="Top queries" rows={sum.queries} label="Query" />
            <QueryTable title="Top pages" rows={sum.pages} label="Page" />
          </div>
        </>
      )}
    </div>
  );
}
