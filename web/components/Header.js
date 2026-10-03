"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, getToken } from "../lib/api";
import Logo from "./Logo";

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => setAuthed(!!getToken()), [pathname]);

  function logout() {
    clearToken();
    setAuthed(false);
    router.push("/");
  }

  return (
    <header className="header">
      <div className="wrap">
        <Logo href={authed ? "/sites" : "/"} />
        {authed ? (
          <nav className="nav">
            <Link href="/sites" className={pathname.startsWith("/sites") ? "active" : ""}>Dashboard</Link>
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
