"use client";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { Badge, Card, Empty } from "../../../../components/ui";
import { useSite } from "../SiteContext";

export default function Pages() {
  const { id } = useSite();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    api(`/sites/${id}/pages`).then(setRows).catch((e) => setErr(e.message));
  }, [id]);

  const shown = (rows || []).filter((p) => !q || p.url.toLowerCase().includes(q.toLowerCase()) || (p.title || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <Card title={`Crawled pages${rows ? ` (${rows.length})` : ""}`} actions={<input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />} flush>
      {err && <div className="notice error" style={{ margin: "14px 20px" }}>{err}</div>}
      {rows === null ? <Empty>Loading...</Empty> : shown.length === 0 ? <Empty>No pages yet. Run an audit first.</Empty> : (
        <div className="table-wrap scroll" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Page</th><th>Status</th><th>Words</th><th>Inlinks</th><th>Load (s)</th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.url}>
                  <td>
                    <b>{p.title || <span className="err">Missing title</span>}</b>
                    <div><a href={p.url} target="_blank" rel="noreferrer" className="small">{p.url}</a></div>
                    {p.meta_description ? <div className="muted">{p.meta_description}</div> : <div className="err small">Missing meta description</div>}
                  </td>
                  <td><Badge tone={p.status >= 400 ? "failed" : p.status >= 300 ? "warn" : "done"}>{p.status}</Badge></td>
                  <td>{p.word_count ?? "-"}</td>
                  <td>{p.inlinks ?? "-"}</td>
                  <td>{p.response_time_s != null ? Number(p.response_time_s).toFixed(2) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
