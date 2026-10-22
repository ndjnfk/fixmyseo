"use client";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { Card, Empty } from "../../../../components/ui";
import { useSite } from "../SiteContext";

const short = (u) => u.replace(/^https?:\/\/(www\.)?[^/]+/, "") || "/";

export default function Links() {
  const { id, data } = useSite();
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const runId = data?.runs.find((r) => r.status === "done")?.id;

  useEffect(() => { api(`/sites/${id}/links`).then(setRes).catch((e) => setErr(e.message)); }, [id, runId]);

  const items = (res?.items || []).filter((i) => !q || i.target_url.includes(q) || i.source_url.includes(q));
  return (
    <div className="stack">
      <Card title="Internal linking suggestions" actions={<input placeholder="Filter by URL..." value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />}>
        <p className="muted small" style={{ margin: 0 }}>
          Pages that already talk about a topic but do not link to the page that targets it. Pages with the fewest incoming links come first.
          Computed from the latest audit; no AI involved.
        </p>
      </Card>
      {err && <div className="notice error">{err}</div>}
      <Card flush>
        {res === null ? <Empty>Loading...</Empty> : items.length === 0 ? <Empty title="No suggestions">{res.run_id ? "Every topical page already links to its targets, or the site is too small." : "Run an audit first."}</Empty> : (
          <div className="table-wrap scroll" style={{ maxHeight: 640 }}>
            <table>
              <thead><tr><th>Add a link on</th><th>Pointing to</th><th>Suggested anchor</th><th>Why</th><th>Score</th></tr></thead>
              <tbody>
                {items.map((i, n) => (
                  <tr key={n}>
                    <td><a href={i.source_url} target="_blank" rel="noreferrer">{short(i.source_url)}</a></td>
                    <td><a href={i.target_url} target="_blank" rel="noreferrer">{short(i.target_url)}</a><div className="muted small">{i.target_inlinks} inlinks now</div></td>
                    <td><b>{i.anchor}</b></td>
                    <td className="muted small">{i.reason}</td>
                    <td><b>{i.score}</b></td>
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
