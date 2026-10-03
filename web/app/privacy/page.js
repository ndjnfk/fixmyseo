import Link from "next/link";
import { APP_NAME, LEGAL_UPDATED, SUPPORT_EMAIL } from "../../lib/site";

export const metadata = { title: `Privacy Policy | ${APP_NAME}` };

const Contact = () => (SUPPORT_EMAIL ? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> : "the support email shown in the app");

export default function Privacy() {
  return (
    <div className="wrap page">
      <article className="card legal">
        <h1>Privacy Policy</h1>
        <p className="muted">Last updated: {LEGAL_UPDATED}</p>

        <p>
          {APP_NAME} is an SEO tool that audits websites, researches keywords and shows Google Search Console data so
          site owners can improve their search rankings. This policy explains what data we collect, how we use it and the
          choices you have.
        </p>

        <h2>1. Data we collect</h2>
        <ul>
          <li><b>Account data:</b> your email address, organization name and password. Passwords are stored only as a one-way hash.</li>
          <li><b>Websites you add:</b> the URL of each site, and information our crawler reads from its <i>public</i> pages (titles, headings, meta tags, links, word counts, response times).</li>
          <li><b>Settings you enter:</b> such as business notes, topics, blocked words and alert webhook URLs.</li>
          <li><b>Google user data</b>, only if you choose to connect Google (see section 2).</li>
        </ul>

        <h2>2. Google user data</h2>
        <p>When you click &quot;Connect Google&quot;, you are asked to grant {APP_NAME} access to:</p>
        <ul>
          <li><b>Your email address</b> (<code>openid</code>, <code>email</code>), to show which Google account is connected.</li>
          <li><b>Google Search Console</b> (<code>https://www.googleapis.com/auth/webmasters</code>), for the properties you have access to.</li>
        </ul>
        <p>We use this access only to provide features you see in the app:</p>
        <ul>
          <li>list your verified Search Console properties so you can link one to a site;</li>
          <li>read search performance data (queries, pages, clicks, impressions, positions) and show it in reports, keyword research, recommendations and traffic alerts;</li>
          <li>submit your sitemap to Google and check whether your pages are indexed (URL Inspection).</li>
        </ul>
        <p>
          We store an encrypted (AES-256-GCM) refresh token and the synced Search Console data in our database. We do not
          use Google user data for advertising, we do not sell it, and we do not use it to train general AI or machine-learning models.
          Humans do not read your Google data, except when you ask us for support, when needed for security, or when required by law.
        </p>
        <p>
          <b>{APP_NAME}&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>,
          including the Limited Use requirements.</b>
        </p>

        <h2>3. Sharing and service providers</h2>
        <p>We do not sell or rent personal data. We share data only as needed to run the features you use:</p>
        <ul>
          <li><b>Hosting:</b> our servers and database, operated on our behalf.</li>
          <li><b>Google:</b> keyword ideas are looked up through Google&apos;s public search suggestions, using topics from your site (not your personal data).</li>
          <li><b>AI keyword research (optional):</b> if this feature is enabled, your site&apos;s page titles and top Search Console queries may be sent to Anthropic&apos;s Claude API to suggest and group keywords. This data is not used to train their models.</li>
          <li><b>Your alert webhook:</b> if you add a Slack/Discord webhook, alert messages are sent to it.</li>
        </ul>

        <h2>4. Retention and deletion</h2>
        <ul>
          <li><b>Disconnect Google:</b> on any site&apos;s Search Console tab, click &quot;Disconnect&quot;. We revoke the token with Google and delete all synced Search Console and index data. You can also remove access at{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>.</li>
          <li><b>Delete your account:</b> email <Contact /> from your account email and we will delete your account and all related data within 30 days.</li>
          <li>Otherwise we keep data while your account is active.</li>
        </ul>

        <h2>5. Security</h2>
        <p>
          Connections use HTTPS. Google tokens are encrypted at rest, passwords are hashed, and each organization can only
          access its own data. No method of storage is perfectly secure, but we work to protect your data.
        </p>

        <h2>6. Cookies and local storage</h2>
        <p>We store your login session token in your browser&apos;s local storage. We do not use advertising or tracking cookies.</p>

        <h2>7. Children</h2>
        <p>{APP_NAME} is not intended for children under 16 and we do not knowingly collect their data.</p>

        <h2>8. Changes</h2>
        <p>We may update this policy. The date at the top shows the latest version.</p>

        <h2>9. Contact</h2>
        <p>Questions or requests: <Contact />.</p>

        <p className="muted small">See also our <Link href="/terms">Terms of Service</Link>.</p>
      </article>
    </div>
  );
}
