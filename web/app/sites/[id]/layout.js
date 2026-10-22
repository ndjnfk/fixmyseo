"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { api, getToken } from "../../../lib/api";
import { SiteProvider, useSite } from "./SiteContext";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/issues", label: "Issues", count: (d) => d.data?.issues.length },
  { href: "/pages", label: "Pages" },
  { href: "/links", label: "Links" },
  { href: "/content", label: "Content" },
  { href: "/keywords", label: "Keywords", count: (d) => d.auto?.keywords.length },
  { href: "/ai", label: "AI", count: (d) => d.pending },
  { href: "/search-console", label: "Search Console" },
  { href: "/reports", label: "Reports" },
  { href: "/automation", label: "Automation" },
  { href: "/settings", label: "Settings" },
];

function Shell({ children }) {
  const ctx = useSite();
  const { id, data, err, load } = ctx;
  const pathname = usePathname();
  const [runErr, setRunErr] = useState("");
  const base = `/sites/${id}`;

  if (!data) {
    return <div className="wrap page">{err ? <div className="notice error">{err}</div> : <span className="muted">Loading...</span>}</div>;
  }

  const { site, runs, role } = data;
  const active = runs[0] && ["queued", "running"].includes(runs[0].status);
  const canEdit = ["editor", "admin", "owner"].includes(role);

  async function rerun() {
    setRunErr("");
    try { await api(`/sites/${id}/audit`, { method: "POST", body: {} }); load(); } catch (e) { setRunErr(e.message); }
  }

  return (
    <div className="wrap page">
      <div className="site-head">
        <div className="row" style={{ flexWrap: "nowrap", minWidth: 0 }}>
          <div className="avatar">{site.domain[0]}</div>
          <div style={{ minWidth: 0 }}>
            <div className="crumbs"><Link href="/sites">Sites</Link> / {site.domain}</div>
            <h1 style={{ wordBreak: "break-all" }}>{site.domain}</h1>
          </div>
        </div>
        <div className="row">
          <a className="btn ghost" href={site.url || `https://${site.domain}`} target="_blank" rel="noreferrer">Visit site ↗</a>
          {canEdit && <button onClick={rerun} disabled={active}>{active ? `Audit ${runs[0].status}... ${runs[0].progress || 0}%` : "Re-run audit"}</button>}
        </div>
      </div>
      {runErr && <div className="notice error" style={{ marginBottom: 16 }}>{runErr}</div>}

      <nav className="tabs">
        {TABS.map((t) => {
          const href = base + t.href;
          const on = t.href ? pathname.startsWith(href) : pathname === base;
          const n = t.count?.(ctx);
          return (
            <Link key={t.label} href={href} className={on ? "active" : ""}>
              {t.label}{n > 0 && <span className="count">{n}</span>}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}

export default function SiteLayout({ children }) {
  const { id } = useParams();
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!getToken()) router.push("/");
    else setOk(true);
  }, []);

  if (!ok) return null;
  return <SiteProvider id={id}><Shell>{children}</Shell></SiteProvider>;
}
