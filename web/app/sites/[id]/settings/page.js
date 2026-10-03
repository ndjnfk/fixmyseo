"use client";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { Card, Field } from "../../../../components/ui";
import { useSite } from "../SiteContext";

function OnOff({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="auto">auto</option>
      <option value="off">off</option>
    </select>
  );
}

export default function Settings() {
  const { id, auto, loadAuto } = useSite();
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Take a snapshot once; don't let background polling overwrite unsaved edits.
  useEffect(() => { if (auto && !cfg) setCfg(auto.config); }, [auto]);
  if (!cfg) return <span className="muted">Loading...</span>;

  const set = (sec, key, val) => setCfg({ ...cfg, [sec]: { ...cfg[sec], [key]: val } });

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      const { autonomy, content, keywords, alerts } = cfg;
      await api(`/sites/${id}/automation`, { method: "PUT", body: { config: { autonomy, content, keywords, alerts } } });
      setMsg("Saved"); loadAuto();
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }

  return (
    <form className="stack" onSubmit={save}>
      <Card title="What runs automatically">
        <div className="grid2">
          <Field label="Keyword research (weekly)"><OnOff value={cfg.autonomy.keywords} onChange={(v) => set("autonomy", "keywords", v)} /></Field>
          <Field label="Sitemap submit + index check (daily)"><OnOff value={cfg.autonomy.indexing} onChange={(v) => set("autonomy", "indexing", v)} /></Field>
        </div>
      </Card>

      <Card title="Keyword research">
        <div className="stack" style={{ gap: 14 }}>
          <div className="grid2">
            <Field label="Language"><input value={cfg.content.language} onChange={(e) => set("content", "language", e.target.value)} /></Field>
            <Field label="Country (2 letter)"><input value={cfg.content.country} onChange={(e) => set("content", "country", e.target.value.toUpperCase())} /></Field>
          </div>
          <Field label="Business notes" hint="What you sell and who your audience is. This helps find better keywords.">
            <textarea rows={4} value={cfg.content.notes} onChange={(e) => set("content", "notes", e.target.value)} />
          </Field>
          <div className="grid2">
            <Field label="Your topics (one per line)" hint="Main services or topics you want to rank for. Research starts from these first.">
              <textarea rows={5} value={cfg.keywords.seeds} placeholder={"kundli matching\nfree horoscope\nvastu tips"}
                onChange={(e) => set("keywords", "seeds", e.target.value)} />
            </Field>
            <Field label="Blocked words (comma separated)" hint="Keywords containing these words are never suggested, e.g. competitor brands or unrelated topics.">
              <textarea rows={5} value={cfg.keywords.exclude} placeholder="witchcraft, template, jessica adams"
                onChange={(e) => set("keywords", "exclude", e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Alerts">
        <div className="grid2">
          <Field label="Webhook URL (Slack/Discord, optional)"><input value={cfg.alerts.webhook} onChange={(e) => set("alerts", "webhook", e.target.value.trim())} placeholder="https://hooks.slack.com/..." /></Field>
          <Field label="Alert when traffic drops by (%)"><input type="number" min="5" max="90" value={cfg.alerts.pause_on_drop_pct} onChange={(e) => set("alerts", "pause_on_drop_pct", Number(e.target.value))} /></Field>
        </div>
      </Card>

      <div className="row">
        <button disabled={busy}>{busy ? "Saving..." : "Save settings"}</button>
        {msg && <span className={msg === "Saved" ? "ok" : "err"}>{msg === "Saved" ? "✓ Saved" : msg}</span>}
      </div>
    </form>
  );
}
