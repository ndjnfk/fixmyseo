"use client";
import { useState } from "react";
import { Badge, Card, Chips, Empty } from "../../../../components/ui";
import { useSite } from "../SiteContext";

export default function Issues() {
  const { data } = useSite();
  const { runs, summary, issues } = data;
  const [sev, setSev] = useState("all");
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");

  const sevCount = (s) => issues.filter((i) => i.severity === s).length;
  const types = [...new Set(summary.map((s) => s.type))];
  const shown = issues.filter((i) =>
    (sev === "all" || i.severity === sev) &&
    (type === "all" || i.type === type) &&
    (!q || i.url.toLowerCase().includes(q.toLowerCase())));

  return (
    <Card flush>
      <div style={{ padding: "16px 20px", display: "grid", gap: 12 }}>
        <div className="row between">
          <Chips value={sev} onChange={setSev} options={[
            { value: "all", label: `All (${issues.length})` },
            { value: "high", label: `High (${sevCount("high")})` },
            { value: "med", label: `Medium (${sevCount("med")})` },
            { value: "low", label: `Low (${sevCount("low")})` },
          ]} />
          <div className="row" style={{ gap: 8 }}>
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: "auto" }}>
              <option value="all">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input placeholder="Search URL..." value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          </div>
        </div>
      </div>
      {shown.length === 0 ? (
        <Empty>{runs.some((r) => r.status === "done") ? "No issues match this filter." : "Audit is not complete yet."}</Empty>
      ) : (
        <div className="table-wrap scroll">
          <table>
            <thead><tr><th>Severity</th><th>Type</th><th>URL</th><th>Detail</th></tr></thead>
            <tbody>
              {shown.slice(0, 500).map((i, n) => (
                <tr key={n}>
                  <td><Badge tone={i.severity}>{i.severity}</Badge></td>
                  <td className="nowrap">{i.type}</td>
                  <td><a href={i.url} target="_blank" rel="noreferrer">{i.url}</a></td>
                  <td className="muted">{i.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
