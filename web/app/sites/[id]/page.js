"use client";
import Link from "next/link";
import { Badge, Card, Empty, Stat } from "../../../components/ui";
import { JOB_LABEL, useSite, when } from "./SiteContext";
import { RecList, useRecommendations } from "./Recommendations";

export default function Overview() {
  const { id, data, auto } = useSite();
  const { recs } = useRecommendations();
  const { site, runs, summary } = data;
  const base = `/sites/${id}`;
  const count = (sev) => summary.filter((s) => s.severity === sev).reduce((a, s) => a + s.count, 0);
  const lastDone = runs.find((r) => r.status === "done");
  const cfg = auto?.config;
  const gaps = auto?.keywords.filter((k) => k.status === "gap").length ?? 0;
  const alerts = auto?.alerts.length ?? 0;

  return (
    <div className="stack">
      {runs[0]?.status === "failed" && <div className="notice error">Last audit failed: {runs[0].error}</div>}

      <div className="stats">
        <Stat label="Pages crawled" value={lastDone?.pages_crawled ?? "-"} sub={lastDone?.finished_at ? `Audit: ${when(lastDone.finished_at)}` : "No audit yet"} />
        <Stat label="High issues" value={count("high")} tone={count("high") ? "high" : "ok"} />
        <Stat label="Medium issues" value={count("med")} tone={count("med") ? "med" : "ok"} />
        <Stat label="Low issues" value={count("low")} />
      </div>

      {recs?.items.length > 0 && (
        <Card title="Top recommendations" actions={<Link href={`${base}/recommendations`} className="small">See all {recs.items.length} →</Link>}>
          <RecList items={recs.items.slice(0, 4)} compact />
        </Card>
      )}

      <div className="split">
        <Card title="Top issue types" actions={<Link href={`${base}/issues`} className="small">View all →</Link>} flush>
          {summary.length === 0 ? (
            <Empty>{lastDone ? "No issues found. 🎉" : "Audit is not complete yet."}</Empty>
          ) : (
            <div className="table-wrap" style={{ marginTop: 14 }}>
              <table>
                <thead><tr><th>Issue</th><th>Severity</th><th>Count</th></tr></thead>
                <tbody>
                  {summary.slice(0, 8).map((s) => (
                    <tr key={s.type + s.severity}>
                      <td>{s.type}</td>
                      <td><Badge tone={s.severity}>{s.severity}</Badge></td>
                      <td><b>{s.count}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Setup status">
          <div className="status-list">
            <div><span>Search Console</span><Badge tone={site.gsc_property ? "done" : "warn"}>{site.gsc_property ? "Linked" : "Not linked"}</Badge></div>
            <div><span>Keyword gaps</span><Link href={`${base}/keywords`}><b>{gaps}</b></Link></div>
            <div><span>Alerts</span><Link href={`${base}/automation`}><b>{alerts}</b></Link></div>
            <div><span>Keyword research</span><Badge tone={cfg?.autonomy.keywords === "off" ? "low" : "info"}>{cfg?.autonomy.keywords ?? "…"}</Badge></div>
            <div><span>Indexing</span><Badge tone={cfg?.autonomy.indexing === "off" ? "low" : "info"}>{cfg?.autonomy.indexing ?? "…"}</Badge></div>
          </div>
          {!site.gsc_property && (
            <Link href={`${base}/search-console`} className="btn ghost sm" style={{ marginTop: 14, width: "100%" }}>Connect Search Console</Link>
          )}
        </Card>
      </div>

      <Card title="Recent activity" actions={<Link href={`${base}/automation`} className="small">Automation →</Link>} flush>
        {!auto || auto.log.length === 0 ? (
          <Empty>No activity yet.</Empty>
        ) : (
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table>
              <tbody>
                {auto.log.slice(0, 6).map((l, i) => (
                  <tr key={i}>
                    <td className="nowrap muted">{when(l.created_at)}</td>
                    <td className="nowrap">{JOB_LABEL[l.job] || l.job}</td>
                    <td><Badge tone={l.status === "ok" ? "done" : l.status === "skip" ? "low" : "failed"}>{l.status}</Badge></td>
                    <td className="muted">{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
