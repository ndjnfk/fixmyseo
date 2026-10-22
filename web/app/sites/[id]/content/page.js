"use client";
import { useState } from "react";
import { api } from "../../../../lib/api";
import { Badge, Card, Field, Stat } from "../../../../components/ui";
import { useSite } from "../SiteContext";

export default function Content() {
  const { id, data, auto } = useSite();
  const [url, setUrl] = useState("");
  const [kw, setKw] = useState("");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const pages = [...new Set((data?.issues || []).map((i) => i.url).filter(Boolean))];
  const keywords = (auto?.keywords || []).filter((k) => k.status !== "ignored").slice(0, 200);

  async function check(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try { setRes(await api(`/sites/${id}/content?url=${encodeURIComponent(url)}&keyword=${encodeURIComponent(kw)}`)); }
    catch (e) { setErr(e.message); setRes(null); }
    setBusy(false);
  }

  return (
    <div className="stack">
      <Card title="Content optimizer">
        <p className="muted small" style={{ margin: "0 0 14px" }}>Deterministic on-page checklist for one page against one target keyword (title, H1, intro, depth, links, schema). Pick a keyword from your list or type one.</p>
        <form className="grid2" onSubmit={check}>
          <Field label="Page URL">
            <input list="cpages" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={(data?.site.url || "") + "/"} required />
            <datalist id="cpages">{pages.slice(0, 300).map((u) => <option key={u} value={u} />)}</datalist>
          </Field>
          <Field label="Target keyword">
            <input list="ckw" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="kundli matching" required />
            <datalist id="ckw">{keywords.map((k) => <option key={k.term} value={k.term} />)}</datalist>
          </Field>
          <div className="row"><button disabled={busy}>{busy ? "Checking..." : "Check page"}</button></div>
        </form>
        {err && <div className="notice error" style={{ marginTop: 12 }}>{err}</div>}
      </Card>

      {res && (
        <>
          <div className="stats">
            <Stat label="Content score" value={`${res.score}/100`} tone={res.score >= 70 ? "ok" : res.score >= 40 ? "med" : "high"} sub={res.keyword} />
            <Stat label="Words" value={res.words} sub="600+ recommended" />
            <Stat label="Keyword mentions" value={res.occurrences} />
            <Stat label="Inlinks" value={res.page.inlinks ?? 0} />
          </div>
          <Card title="What to improve first">
            {res.todo.length === 0 ? <p className="ok">Everything on the checklist passes.</p> : (
              <ol style={{ margin: 0, paddingLeft: 20 }}>{res.todo.map((t, i) => <li key={i}><b>{t.label}</b> <span className="muted">— {t.fix}</span></li>)}</ol>
            )}
          </Card>
          <Card title="Checklist" flush>
            <div className="table-wrap" style={{ marginTop: 14 }}>
              <table><tbody>
                {res.checks.map((c) => (
                  <tr key={c.key}><td style={{ width: 90 }}><Badge tone={c.ok ? "done" : "warn"}>{c.ok ? "pass" : "fix"}</Badge></td><td>{c.label}</td><td className="muted">{c.ok ? "" : c.fix}</td><td className="muted nowrap">{c.weight} pts</td></tr>
                ))}
              </tbody></table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
