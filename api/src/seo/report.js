// Health score and report snapshots. Score = 100 - weighted issue density, bounded; deltas vs previous report.
import { db, json } from "../db.js";

const WEIGHT = { high: 5, med: 2, low: 0.5 };

export function healthScore(rows, issues) {
  const pages = Math.max(1, rows.filter((r) => r.status === 200).length);
  let penalty = 0;
  for (const i of issues) penalty += WEIGHT[i.severity] || 1;
  // normalise per page so a 500-page site is not punished more than a 5-page one
  const perPage = penalty / pages;
  const score = Math.round(100 / (1 + perPage));
  return Math.max(0, Math.min(100, score));
}

export function buildReport({ site, run, rows, issues, summary, previous }) {
  const counts = { high: 0, med: 0, low: 0 };
  for (const i of issues) counts[i.severity]++;
  const byType = {};
  for (const i of issues) byType[i.type] = (byType[i.type] || 0) + 1;
  const ok = rows.filter((r) => r.status === 200);
  const score = healthScore(rows, issues);
  const report = {
    site: site.domain, run_id: run.id, generated_at: new Date().toISOString(),
    score, pages: rows.length, pages_ok: ok.length,
    issues: counts, by_type: byType,
    avg_response_s: ok.length ? +(ok.reduce((a, r) => a + (r.time_s || 0), 0) / ok.length).toFixed(2) : null,
    avg_words: ok.length ? Math.round(ok.reduce((a, r) => a + (r.word_count || 0), 0) / ok.length) : null,
    with_schema: ok.filter((r) => r.schema_types).length,
    site_stats: summary._site || null,
    top_issues: Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([type, n]) => ({ type, count: n })),
    delta: null,
  };
  if (previous) {
    const p = typeof previous === "string" ? JSON.parse(previous) : previous;
    const fixed = [], regressed = [];
    for (const [t, n] of Object.entries(p.by_type || {})) {
      const now = byType[t] || 0;
      if (now < n) fixed.push({ type: t, before: n, after: now });
    }
    for (const [t, n] of Object.entries(byType)) {
      const before = p.by_type?.[t] || 0;
      if (n > before) regressed.push({ type: t, before, after: n });
    }
    report.delta = {
      previous_run_id: p.run_id, previous_at: p.generated_at,
      score: score - (p.score ?? score), pages: rows.length - (p.pages ?? rows.length),
      high: counts.high - (p.issues?.high ?? 0), med: counts.med - (p.issues?.med ?? 0), low: counts.low - (p.issues?.low ?? 0),
      fixed, regressed,
    };
  }
  return report;
}

export async function saveAuditReport(conn, { site, run, rows, issues, summary }) {
  const [[prev]] = await conn.query(
    "SELECT report_json FROM reports WHERE site_id=? AND kind='audit' AND run_id<>? ORDER BY id DESC LIMIT 1", [site.id, run.id]);
  const report = buildReport({ site, run, rows, issues, summary, previous: prev ? json(prev.report_json) : null });
  const [r] = await conn.query(
    `INSERT INTO reports (org_id, site_id, run_id, kind, score, pages, issues_high, issues_med, issues_low, report_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [site.org_id, site.id, run.id, "audit", report.score, report.pages, report.issues.high, report.issues.med, report.issues.low, JSON.stringify(report)]);
  return { id: r.insertId, ...report };
}

export async function listReports(siteId, limit = 50) {
  const [rows] = await db.query(
    "SELECT id, run_id, kind, score, pages, issues_high, issues_med, issues_low, created_at FROM reports WHERE site_id=? ORDER BY id DESC LIMIT ?", [siteId, limit]);
  return rows;
}
