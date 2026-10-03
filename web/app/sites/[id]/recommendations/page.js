"use client";
import { useState } from "react";
import { Card, Chips, Empty } from "../../../../components/ui";
import { RecList, useRecommendations } from "../Recommendations";

export default function Recommendations() {
  const { recs, err } = useRecommendations();
  const [level, setLevel] = useState("all");

  if (err) return <div className="notice error">{err}</div>;
  if (!recs) return <span className="muted">Loading...</span>;
  if (!recs.ready) return <Card><Empty title="No audit yet">Recommendations appear after the first audit finishes.</Empty></Card>;

  const n = (l) => recs.items.filter((r) => r.level === l).length;
  const shown = level === "all" ? recs.items : recs.items.filter((r) => r.level === level);

  return (
    <div className="stack">
      <Card>
        <div className="row between">
          <p className="muted" style={{ margin: 0, maxWidth: 620 }}>
            What to do next, in order. Built from your latest audit, keyword research, Search Console data and Google index status.
          </p>
          <Chips value={level} onChange={setLevel} options={[
            { value: "all", label: `All (${recs.items.length})` },
            { value: "fix", label: `Fix (${n("fix")})` },
            { value: "caution", label: `Caution (${n("caution")})` },
            { value: "improve", label: `Improve (${n("improve")})` },
          ]} />
        </div>
      </Card>
      {shown.length === 0
        ? <Card><Empty title="Nothing here">No recommendations in this group. 🎉</Empty></Card>
        : <RecList items={shown} />}
    </div>
  );
}
