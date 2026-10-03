"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useSite } from "./SiteContext";

const LEVEL = {
  fix: { label: "Fix", tone: "high" },
  caution: { label: "Caution", tone: "med" },
  improve: { label: "Improve", tone: "info" },
};

// Reloads whenever a new audit finishes or the keyword list changes.
export function useRecommendations() {
  const { id, data, auto } = useSite();
  const [recs, setRecs] = useState(null);
  const [err, setErr] = useState("");
  const runId = data?.runs.find((r) => r.status === "done")?.id;
  const kwCount = auto?.keywords.length;

  useEffect(() => {
    api(`/sites/${id}/recommendations`).then(setRecs).catch((e) => setErr(e.message));
  }, [id, runId, kwCount]);
  return { recs, err };
}

export function RecList({ items, compact }) {
  const { id } = useSite();
  return (
    <div className="stack" style={{ gap: 12 }}>
      {items.map((r) => {
        const lv = LEVEL[r.level];
        return (
          <article key={r.key} className={`rec ${compact ? "compact" : ""}`}>
            <span className={`badge rec-badge ${lv.tone}`}>{lv.label}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3>{r.title}</h3>
              <p className="muted">{r.detail}</p>
              {!compact && (
                <>
                  <p className="rec-how"><b>How to fix:</b> {r.how}</p>
                  {r.urls.length > 0 && (
                    <div className="rec-urls">
                      {r.urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">{u.replace(/^https?:\/\/(www\.)?/, "")}</a>)}
                    </div>
                  )}
                  <Link href={`/sites/${id}/${r.tab}`} className="small">Open {r.tab.replace("-", " ")} →</Link>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
