"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, clearToken, getToken, setOrg } from "../lib/api";
import Logo from "./Logo";

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState(null);
  const authed = Boolean(me);

  useEffect(() => {
    if (!getToken()) { setMe(null); return; }
    api("/me").then(setMe).catch(() => setMe(null));
  }, [pathname]);

  function logout() {
    clearToken();
    setMe(null);
    router.push("/");
  }

  function switchOrg(e) {
    setOrg(e.target.value);
    window.location.href = "/sites";
  }

  const cls = (p) => (pathname.startsWith(p) ? "active" : "");
  return (
    <header className="header">
      <div className="wrap">
        <Logo href={authed ? "/sites" : "/"} />
        {authed ? (
          <nav className="nav">
            <Link href="/sites" className={cls("/sites")}>Dashboard</Link>
            <Link href="/team" className={cls("/team")}>Team</Link>
            <Link href="/billing" className={cls("/billing")}>Plan <span className="badge info" style={{ marginLeft: 4 }}>{me.org.plan}</span></Link>
            {me.orgs.length > 1 && (
              <select value={me.org.id} onChange={switchOrg} style={{ width: "auto", padding: "5px 8px", fontSize: 13 }} aria-label="Organization">
                {me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.role})</option>)}
              </select>
            )}
            <button className="ghost sm" onClick={logout}>Logout</button>
          </nav>
        ) : (
          <nav className="nav">
            <Link href="/" className={pathname === "/" ? "active" : ""}>Login</Link>
          </nav>
        )}
      </div>
    </header>
  );
}
