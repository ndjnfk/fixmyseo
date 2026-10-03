"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, Card, Empty } from "../../../../components/ui";
import { JOB_LABEL, useSite, when } from "../SiteContext";

export default function Automation() {
  const { id, auto, call } = useSite();
  const [err, setErr] = useState("");
  if (!auto) return <span className="muted">Loading...</span>;

  const cfg = auto.config;
  const run = async (job) => { setErr(""); setErr(await call(`/sites/${id}/automation/run`, { job })); };

  return (
    <div className="stack">
      <Card title="Automation" actions={
        <>
          <Link href={`/sites/${id}/settings`} className="btn ghost">Settings</Link>
          <button disabled={auto.running} onClick={() => run("all")}>{auto.running ? "Running..." : "Run all now"}</button>
        </>
      }>
        <div className="row" style={{ gap: 8 }}>
          {Object.entries(cfg.autonomy).map(([k, v]) => <Badge key={k} tone={v === "off" ? "low" : "info"}>{k}: {v}</Badge>)}
        </div>

        <div className="section-title" style={{ marginTop: 20 }}>Run a single job</div>
        <div className="row" style={{ gap: 8 }}>
          {auto.jobs.map((j) => (
            <button key={j} className="ghost sm" disabled={auto.running} onClick={() => run(j)}>{JOB_LABEL[j] || j}</button>
          ))}
        </div>
        {err && <div className="notice error" style={{ marginTop: 12 }}>{err}</div>}
      </Card>

      {auto.alerts.length > 0 && (
        <Card title="Alerts" flush>
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table><tbody>
              {auto.alerts.map((a, i) => (
                <tr key={i}>
                  <td><Badge tone={a.severity}>{a.type}</Badge></td>
                  <td>{a.subject}</td>
                  <td className="muted">{a.detail}</td>
                  <td className="muted nowrap">{when(a.created_at)}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </Card>
      )}

      {auto.index.length > 0 && (
        <Card title="Google index status" flush>
          <div className="table-wrap scroll" style={{ marginTop: 14, maxHeight: 400 }}>
            <table>
              <thead><tr><th>URL</th><th>Verdict</th><th>Coverage</th><th>Last crawl</th></tr></thead>
              <tbody>
                {auto.index.map((i) => (
                  <tr key={i.url}>
                    <td>{i.url}</td>
                    <td><Badge tone={i.verdict === "PASS" ? "done" : "med"}>{i.verdict || "?"}</Badge></td>
                    <td className="muted">{i.coverage}</td>
                    <td className="muted nowrap">{i.last_crawl ? when(i.last_crawl) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Activity log" flush>
        {auto.log.length === 0 ? (
          <Empty>The scheduler checks every 30 minutes. Daily jobs run once a day; audit and keywords run once a week.</Empty>
        ) : (
          <div className="table-wrap scroll" style={{ marginTop: 14, maxHeight: 480 }}>
            <table>
              <thead><tr><th>Time</th><th>Job</th><th>Status</th><th>Message</th></tr></thead>
              <tbody>
                {auto.log.map((l, i) => (
                  <tr key={i}>
                    <td className="muted nowrap">{when(l.created_at)}</td>
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
