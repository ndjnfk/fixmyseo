import Link from "next/link";
import { APP_NAME, LEGAL_UPDATED, SUPPORT_EMAIL } from "../../lib/site";

export const metadata = { title: `Terms of Service | ${APP_NAME}` };

export default function Terms() {
  return (
    <div className="wrap page">
      <article className="card legal">
        <h1>Terms of Service</h1>
        <p className="muted">Last updated: {LEGAL_UPDATED}</p>

        <h2>1. The service</h2>
        <p>
          {APP_NAME} audits websites, suggests keywords, shows Google Search Console data and gives SEO recommendations.
          By creating an account you agree to these terms.
        </p>

        <h2>2. Your account and sites</h2>
        <ul>
          <li>Keep your login details safe. You are responsible for activity on your account.</li>
          <li>Only add websites you own or are authorized to manage. Our crawler reads public pages of the sites you add.</li>
          <li>Only connect Google accounts and Search Console properties you are allowed to use.</li>
        </ul>

        <h2>3. Acceptable use</h2>
        <p>Do not use {APP_NAME} to attack, overload or scrape websites you do not control, or for anything illegal.</p>

        <h2>4. No ranking guarantee</h2>
        <p>
          SEO results depend on many factors outside our control, including search engine changes. Recommendations,
          demand and difficulty scores are estimates. We do not guarantee any ranking, traffic or business result.
        </p>

        <h2>5. Availability</h2>
        <p>The service is provided &quot;as is&quot;. We aim for it to be available and accurate but cannot promise it will be uninterrupted or error-free.</p>

        <h2>6. Liability</h2>
        <p>To the extent allowed by law, {APP_NAME} is not liable for indirect or consequential losses arising from use of the service.</p>

        <h2>7. Ending use</h2>
        <p>You can stop using the service and ask us to delete your account at any time. We may suspend accounts that break these terms.</p>

        <h2>8. Contact</h2>
        <p>
          {SUPPORT_EMAIL ? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> : "Use the support email shown in the app"}.
          {" "}See also our <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </article>
    </div>
  );
}
