"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { Badge, Card, Chips, Empty, Stat } from "../../../../components/ui";
import { useSite, when } from "../SiteContext";

const STATUS = {
  existing: { tone: "done", label: "Covered", hint: "A page already targets this. Optimize it." },
  partial: { tone: "info", label: "Partial", hint: "A related page exists. Add a section for this keyword." },
  gap: { tone: "med", label: "Gap", hint: "No page yet. Create a new page or article." },
  planned: { tone: "info", label: "Planned", hint: "" },
  written: { tone: "done", label: "Written", hint: "" },
  ignored: { tone: "low", label: "Ignored", hint: "Hidden from research." },
};

const demandLabel = (d) => (d == null ? null : d >= 60 ? "High" : d >= 35 ? "Medium" : "Low");
const diffLabel = (d) => (d == null ? null : d < 40 ? ["Easy", "done"] : d < 65 ? ["Medium", "med"] : ["Hard", "high"]);
const isQuickWin = (k) => k.position != null && k.position >= 4 && k.position <= 20;

const SORTS = {
  priority: (a, b) => b.priority - a.priority || (b.demand ?? 0) - (a.demand ?? 0),
  demand: (a, b) => (b.demand ?? -1) - (a.demand ?? -1),
  easiest: (a, b) => (a.difficulty ?? 999) - (b.difficulty ?? 999),
  impressions: (a, b) => Number(b.impressions ?? 0) - Number(a.impressions ?? 0),
  position: (a, b) => (a.position ?? 999) - (b.position ?? 999),
};

function Meter({ value }) {
  return (
    <span className="meter" aria-hidden="true">
      <span style={{ width: `${Math.max(4, value)}%` }} />
    </span>
  );
}

export default function Keywords() {
  const { id, auto, loadAuto, call } = useSite();
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("priority");
  const [q, setQ] = useState("");
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const kw = auto?.keywords || [];
  const active = useMemo(() => kw.filter((k) => k.status !== "ignored"), [kw]);
  if (!auto) return <span className="muted">Loading...</span>;

  const lastRun = auto.log.find((l) => l.job === "keywords");
  const count = (fn) => active.filter(fn).length;
  const FILTERS = {
    all: (k) => k.status !== "ignored",
    quick: (k) => k.status !== "ignored" && isQuickWin(k),
    gap: (k) => k.status === "gap",
    partial: (k) => k.status === "partial",
    existing: (k) => k.status === "existing",
    ignored: (k) => k.status === "ignored",
  };
  const ql = q.toLowerCase();
  const shown = kw
    .filter(FILTERS[filter])
    .filter((k) => !q || k.term.includes(ql) || (k.cluster || "").toLowerCase().includes(ql))
    .sort(SORTS[sort]);

  async function run() {
    setErr(""); setMsg("");
    const e = await call(`/sites/${id}/automation/run`, { job: "keywords" });
    if (e) setErr(e); else setMsg("Keyword research started. It takes 1-2 minutes; the list refreshes on its own.");
  }

  async function addTerms(e) {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await api(`/sites/${id}/keywords`, { method: "POST", body: { terms: add } });
      setAdd(""); setMsg(`${r.added} keyword${r.added === 1 ? "" : "s"} added and scored.`);
      await loadAuto();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function toggle(k) {
    setErr("");
    try {
      await api(`/sites/${id}/keywords`, { method: "PATCH", body: { term: k.term, action: k.status === "ignored" ? "restore" : "ignore" } });
      await loadAuto();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Tracked keywords" value={active.length} />
        <Stat label="Quick wins" value={count(isQuickWin)} tone={count(isQuickWin) ? "ok" : ""} sub="Ranking 4-20 on Google" />
        <Stat label="Gaps" value={count((k) => k.status === "gap")} tone="med" sub="Need a new page" />
        <Stat label="Partial" value={count((k) => k.status === "partial")} sub="Expand an existing page" />
      </div>

      <Card title="Keyword research" actions={
        <button onClick={run} disabled={auto.running}>{auto.running ? "Running..." : "Run research now"}</button>
      }>
        <p className="muted small" style={{ margin: "0 0 14px" }}>
          {lastRun ? <>Last run {when(lastRun.created_at)}: {lastRun.message}</> : "Not run yet."} Runs automatically every week.
          Add your own topics and blocked words in <Link href={`/sites/${id}/settings`}>Settings</Link>.
        </p>
        <form className="row" onSubmit={addTerms}>
          <input style={{ flex: 1, minWidth: 220 }} placeholder="Add your own keywords, comma separated (e.g. kundli matching in hindi, free horoscope)"
            value={add} onChange={(e) => setAdd(e.target.value)} />
          <button className="ghost" disabled={busy || add.trim().length < 2}>{busy ? "Scoring..." : "Add keywords"}</button>
        </form>
        {msg && <div className="notice" style={{ marginTop: 12 }}>{msg}</div>}
        {err && <div className="notice error" style={{ marginTop: 12 }}>{err}</div>}
      </Card>

      <Card flush>
        <div className="row between" style={{ padding: "16px 20px" }}>
          <Chips value={filter} onChange={setFilter} options={[
            { value: "all", label: `All (${active.length})` },
            { value: "quick", label: `Quick wins (${count(isQuickWin)})` },
            { value: "gap", label: `Gap (${count((k) => k.status === "gap")})` },
            { value: "partial", label: `Partial (${count((k) => k.status === "partial")})` },
            { value: "existing", label: `Covered (${count((k) => k.status === "existing")})` },
            { value: "ignored", label: `Ignored (${kw.length - active.length})` },
          ]} />
          <div className="row" style={{ gap: 8 }}>
            <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: "auto" }} aria-label="Sort by">
              <option value="priority">Sort: Priority</option>
              <option value="demand">Sort: Demand</option>
              <option value="easiest">Sort: Easiest first</option>
              <option value="impressions">Sort: Impressions</option>
              <option value="position">Sort: Google position</option>
            </select>
            <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} />
          </div>
        </div>

        {kw.length === 0 ? (
          <Empty title="No keywords yet">Click "Run research now" above, or add your own keywords.</Empty>
        ) : shown.length === 0 ? <Empty>Nothing matches this filter.</Empty> : (
          <div className="table-wrap scroll">
            <table>
              <thead>
                <tr>
                  <th>Keyword</th><th>Demand</th><th>Difficulty</th><th>Position</th><th>Priority</th><th>Status</th><th>Target page</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((k) => {
                  const st = STATUS[k.status] || STATUS.gap;
                  const dl = diffLabel(k.difficulty);
                  return (
                    <tr key={k.term} style={k.status === "ignored" ? { opacity: 0.6 } : undefined}>
                      <td>
                        <b>{k.term}</b>
                        <div className="muted">
                          {k.cluster} · {k.intent}{k.source === "manual" && " · added by you"}
                        </div>
                      </td>
                      <td className="nowrap">
                        {k.demand == null ? <span className="muted">-</span> : (
                          <>
                            <Meter value={k.demand} /> {demandLabel(k.demand)}
                            <div className="muted small">
                              {k.demand_src === "gsc" ? `${Number(k.impressions || 0).toLocaleString()} impr. (real)` : "estimated"}
                            </div>
                          </>
                        )}
                      </td>
                      <td>{dl ? <Badge tone={dl[1]}>{dl[0]}</Badge> : <span className="muted">-</span>}</td>
                      <td className="nowrap">
                        {k.position != null ? (
                          <>
                            <b>{Number(k.position).toFixed(1)}</b>
                            {isQuickWin(k) && <div><Badge tone="done">Quick win</Badge></div>}
                          </>
                        ) : <span className="muted">Not ranking</span>}
                      </td>
                      <td><b>{k.priority}</b><span className="muted">/10</span></td>
                      <td title={st.hint}><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td className="muted">
                        {k.target_url ? <a href={k.target_url} target="_blank" rel="noreferrer">{k.target_url.replace(/^https?:\/\/(www\.)?/, "")}</a> : "-"}
                      </td>
                      <td>
                        <button className="ghost sm" onClick={() => toggle(k)}>{k.status === "ignored" ? "Restore" : "Ignore"}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="How to use this list">
        <div className="grid2 small">
          <div><Badge tone="done">Quick win</Badge> <span className="muted">You already rank 4-20. Improve that page first (title, H1, more depth). Fastest results.</span></div>
          <div><Badge tone="med">Gap</Badge> <span className="muted">No page covers it. Write a new page or article, one per cluster.</span></div>
          <div><Badge tone="info">Partial</Badge> <span className="muted">A related page exists. Add a section or FAQ for this keyword to that page.</span></div>
          <div><Badge tone="done">Covered</Badge> <span className="muted">A page targets it. Make sure the keyword is in its title and H1.</span></div>
        </div>
        <p className="muted small" style={{ margin: "14px 0 0" }}>
          <b>Demand</b> uses real Search Console impressions when available; otherwise it is estimated from Google Autocomplete.
          <b> Difficulty</b> is an estimate from keyword length, intent and your current position. Free data has no exact search volume
          or competitor strength, so check a few results on Google before writing.
        </p>
      </Card>
    </div>
  );
}
