import Link from "next/link";

export default function Logo({ href = "/sites" }) {
  return (
    <Link href={href} className="brand" aria-label="FixMySEO home">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <circle cx="14" cy="14" r="6.5" fill="none" stroke="#fff" strokeWidth="2.6" />
        <path d="M19 19l5.5 5.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M11.3 14.2l2 2 3.6-4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Fix<span className="accent">My</span>SEO</span>
    </Link>
  );
}
