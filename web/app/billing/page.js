"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, when } from "../../lib/api";
import { Badge, Card, Empty, PageHead, Stat } from "../../components/ui";

const inr = (p) => (p === 0 ? "Free" : `₹${(p / 100).toLocaleString("en-IN")}/mo`);

function Meter({ used, limit }) {
  const pct = limit ? Math.min(100, Math.round((100 * used) / limit)) : 0;
  return <span className="meter" style={{ width: 120 }}><span style={{ width: `${pct}%`, background: pct >= 90 ? "var(--high)" : "var(--accent)" }} /></span>;
}

export default function Billing() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [b, setB] = useState(null);
  const [plans, setPlans] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => Promise.all([api("/me").then(setMe), api("/billing").then(setB), api("/plans").then(setPlans)]).catch((e) => setErr(e.message));
  useEffect(() => { if (!getToken()) return router.push("/"); load(); }, []);

  async function change(code) {
    setErr(""); setBusy(code);
    try { await api("/billing/change-plan", { method: "POST", body: { plan_code: code } }); await load(); }
    catch (e) { setErr(e.message); }
    setBusy("");
  }

  if (!b || !me) return <div className="wrap page">{err ? <div className="notice error">{err}</div> : <span className="muted">Loading...</span>}</div>;
  const u = b.usage;
  const isOwner = me.org.role === "owner";
  return (
    <div className="wrap page">
      <PageHead title="Plan & usage" desc={`${me.org.name} · current plan: ${b.plan.name}`} />
      <div className="stack">
        {b.plan.degraded_from && <div className="notice warn">Your {b.plan.degraded_from} subscription is {b.plan.status}; limits fell back to the Free plan.</div>}
        <div className="stats">
          <Stat label="Sites" value={`${u.sites.used} / ${u.sites.limit ?? "∞"}`} />
          <Stat label="Pages crawled this month" value={`${u.crawl_pages.used}${u.crawl_pages.reserved ? ` (+${u.crawl_pages.reserved} running)` : ""}`} sub={`limit ${b.plan.limits.crawl_pages ?? "∞"}`} />
          <Stat label="AI operations this month" value={`${u.ai_ops.used}${u.ai_ops.reserved ? ` (+${u.ai_ops.reserved} running)` : ""}`} sub={`limit ${b.plan.limits.ai_ops ?? "∞"}`} />
          <Stat label="Scheduled audits" value={b.plan.limits.scheduled_audits} sub={b.plan.limits.gsc ? "Search Console included" : "Search Console not included"} />
        </div>
        {err && <div className="notice error">{err}</div>}
        <div className="site-grid">
          {plans.map((p) => (
            <Card key={p.code} title={p.name} actions={<Badge tone={p.code === b.plan.code ? "done" : "low"}>{p.code === b.plan.code ? "current" : inr(p.price_paise)}</Badge>}>
              <ul className="small" style={{ paddingLeft: 18, margin: "0 0 12px" }}>
                <li>{p.limits.sites} active site{p.limits.sites === 1 ? "" : "s"}</li>
                <li>{p.limits.crawl_pages.toLocaleString()} crawled pages / month</li>
                <li>{p.limits.ai_ops} AI operations / month</li>
                <li>Scheduled audits: {p.limits.scheduled_audits}</li>
                <li>Search Console: {p.limits.gsc ? "yes" : "no"}</li>
                <li>Export: {p.limits.export}</li>
              </ul>
              {isOwner && p.code !== b.plan.code && (
                <button className="sm" disabled={Boolean(busy)} onClick={() => change(p.code)}>{busy === p.code ? "Switching..." : b.provider === "test" ? "Switch (test mode)" : "Choose"}</button>
              )}
            </Card>
          ))}
        </div>
        <Card title="Subscription" flush>
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table><tbody>
              <tr><td>Status</td><td><Badge tone={b.subscription?.status === "active" ? "done" : "warn"}>{b.subscription?.status || "none"}</Badge></td></tr>
              <tr><td>Provider</td><td>{b.subscription?.provider || "-"} {b.provider === "test" && <span className="muted small">(test mode: no real payments; a gateway is wired through the webhook endpoint)</span>}</td></tr>
              <tr><td>Current period</td><td>{when(b.subscription?.period_start)} → {when(b.subscription?.period_end)}</td></tr>
              {b.subscription?.grace_until && <tr><td>Grace until</td><td>{when(b.subscription.grace_until)}</td></tr>}
            </tbody></table>
          </div>
        </Card>
        <Card title="Payment events" flush>
          {b.events.length === 0 ? <Empty>No events yet.</Empty> : (
            <div className="table-wrap" style={{ marginTop: 14 }}>
              <table><thead><tr><th>When</th><th>Provider</th><th>Event</th><th>Processed</th></tr></thead><tbody>
                {b.events.map((e) => <tr key={e.provider_event_id}><td className="nowrap">{when(e.created_at)}</td><td>{e.provider}</td><td>{e.event_type}</td><td>{e.processed_at ? "yes" : "pending"}</td></tr>)}
              </tbody></table>
            </div>
          )}
        </Card>
        <p className="muted small">Not an owner? Only the organization owner can change the plan.</p>
        <Meter used={0} limit={1} />
      </div>
    </div>
  );
}
