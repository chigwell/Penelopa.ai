import Image from "next/image";
import ReactMarkdown from "react-markdown";

type LegalPageProps = {
  title: string;
  updated: string;
  markdown: string;
};

export default function LegalPage({ title, updated, markdown }: LegalPageProps) {
  const documentMarkdown = markdown.replace(/^# .+\n\n\*\*Last updated:\*\*.*\n\n/, "");

  return (
    <main className="legal-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" aria-label="Penelopa.ai home">
            <span className="brand-mark" aria-hidden="true">
              <Image
                src="/penelopa-ai.png"
                alt=""
                width={42}
                height={42}
                priority
                className="brand-logo"
              />
            </span>
            <span className="brand-name">Penelopa.ai</span>
          </a>
          <div className="topbar-actions">
            <a className="dashboard-link" href="/">
              Home
            </a>
            <a className="dashboard-link" href="/dashboard">
              Dashboard
            </a>
          </div>
        </div>
      </header>

      <article className="legal-main">
        <header className="legal-heading">
          <p className="eyebrow">Legal / Penelopa.ai</p>
          <h1>{title}</h1>
          <p>{updated}</p>
        </header>
        <section className="legal-document" aria-label={title}>
          <ReactMarkdown>{documentMarkdown}</ReactMarkdown>
        </section>
      </article>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <p>Copyright 2026 Penelopa.ai. Made by Eugene Evstafev.</p>
          <nav className="footer-links" aria-label="Legal links">
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
            <a href="mailto:support@penelopa.ai">support@penelopa.ai</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
