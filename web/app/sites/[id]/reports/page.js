"use client";
import { useEffect, useState } from "react";
import { api, when } from "../../../../lib/api";
import { Badge, Card, Empty, Stat } from "../../../../components/ui";
import { useSite } from "../SiteContext";

const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

export default function Reports() {
  const { id, data } = useSite();
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState("");
  const runId = data?.runs.find((r) => r.status === "done")?.id;

  useEffect(() => {
    api(`/sites/${id}/reports`).then((l) => { setList(l); if (l[0]) open(l[0].id); }).catch((e) => setErr(e.message));
  }, [id, runId]);

  const open = (rid) => api(`/sites/${id}/reports/${rid}`).then(setSel).catch((e) => setErr(e.message));
  const r = sel?.report;

  return (
    <div className="stack">
      {err && <div className="notice error">{err}</div>}
      {r && (
        <>
          <div className="stats">
            <Stat label="Health score" value={`${r.score}/100`} tone={r.score >= 80 ? "ok" : r.score >= 50 ? "med" : "high"} sub={r.delta ? `${sign(r.delta.score)} vs previous` : "first audit"} />
            <Stat label="Pages" value={r.pages} sub={r.delta ? `${sign(r.delta.pages)} vs previous` : `${r.pages_ok} returned 200`} />
            <Stat label="High issues" value={r.issues.high} tone={r.issues.high ? "high" : "ok"} sub={r.delta ? `${sign(r.delta.high)}` : ""} />
            <Stat label="Medium / low" value={`${r.issues.med} / ${r.issues.low}`} sub={r.delta ? `${sign(r.delta.med)} / ${sign(r.delta.low)}` : ""} />
          </div>
          <div className="split">
            <Card title={`Report #${sel.id} · ${when(sel.created_at)}`}>
              <div className="grid2 small">
                <div><span className="muted">Avg response</span><br /><b>{r.avg_response_s ?? "-"} s</b></div>
                <div><span className="muted">Avg words / page</span><br /><b>{r.avg_words ?? "-"}</b></div>
                <div><span className="muted">Pages with schema</span><br /><b>{r.with_schema} / {r.pages_ok}</b></div>
                <div><span className="muted">Hindi pages</span><br /><b>{r.site_stats?.hindi_pages ?? 0}</b></div>
              </div>
              <div className="section-title">Top issue types</div>
              <div className="table-wrap"><table><tbody>
                {r.top_issues.map((t) => <tr key={t.type}><td>{t.type}</td><td><b>{t.count}</b></td></tr>)}
              </tbody></table></div>
              {r.delta && (
                <>
                  <div className="section-title">Since previous audit (#{r.delta.previous_run_id}, {when(r.delta.previous_at)})</div>
                  {r.delta.fixed.length === 0 && r.delta.regressed.length === 0 && <p className="muted small">No change in issue counts.</p>}
                  {r.delta.fixed.map((f) => <div key={f.type} className="small"><Badge tone="done">fixed</Badge> {f.type}: {f.before} → {f.after}</div>)}
                  {r.delta.regressed.map((f) => <div key={f.type} className="small"><Badge tone="high">new</Badge> {f.type}: {f.before} → {f.after}</div>)}
                </>
              )}
            </Card>
            <Card title="History" flush>
              {list === null ? <Empty>Loading...</Empty> : list.length === 0 ? <Empty>No reports yet.</Empty> : (
                <div className="table-wrap scroll" style={{ marginTop: 14, maxHeight: 520 }}>
                  <table>
                    <thead><tr><th>Date</th><th>Score</th><th>Pages</th><th>H/M/L</th></tr></thead>
                    <tbody>
                      {list.map((x) => (
                        <tr key={x.id} onClick={() => open(x.id)} style={{ cursor: "pointer", fontWeight: sel?.id === x.id ? 600 : 400 }}>
                          <td className="nowrap">{when(x.created_at)}</td><td>{x.score}</td><td>{x.pages}</td><td className="muted">{x.issues_high}/{x.issues_med}/{x.issues_low}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
          <Card title="Export">
            <div className="row">
              <button className="ghost sm" onClick={() => download(`report-${sel.id}.json`, JSON.stringify(r, null, 2), "application/json")}>Download JSON</button>
              <button className="ghost sm" onClick={async () => {
                const i = await api(`/sites/${id}/issues?run_id=${sel.run_id}&limit=2000`);
                const csv = ["severity,type,url,detail", ...i.items.map((x) => [x.severity, x.type, x.url, x.detail].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
                download(`issues-${sel.run_id}.csv`, csv, "text/csv");
              }}>Download issues CSV</button>
            </div>
          </Card>
        </>
      )}
      {list && list.length === 0 && <Card><Empty title="No reports yet">A report is stored automatically after every audit.</Empty></Card>}
    </div>
  );
}

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
}
