import Link from "next/link";
import Logo from "./Logo";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <Logo />
            <p className="muted small" style={{ maxWidth: 360, marginTop: 10 }}>
              Audits, keywords, Search Console and alerts: SEO for all your sites in one place, on autopilot.
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li><Link href="/sites">Dashboard</Link></li>
              <li><Link href="/sites">Add a site</Link></li>
            </ul>
          </div>
          <div>
            <h4>Features</h4>
            <ul>
              <li className="muted">Site audit</li>
              <li className="muted">Search Console</li>
              <li className="muted">Keyword research &amp; alerts</li>
            </ul>
          </div>
          <div>
            <h4>Legal</h4>
            <ul>
              <li><Link href="/privacy">Privacy Policy</Link></li>
              <li><Link href="/terms">Terms of Service</Link></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom row between muted">
          <span>© {new Date().getFullYear()} FixMySEO. All rights reserved.</span>
          <span>Made for growing websites</span>
        </div>
      </div>
    </footer>
  );
}
