"use client";

import { AlertCircle, ArrowLeft, ArrowUpRight, Inbox, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTheme } from "../../lib/use-theme";
import { useDesktop, type ApiError } from "../../lib/penelopa-client";
import { AccessTokenForm, DashboardTopbar } from "../PageChrome";
import type { useSessionAccess } from "./use-session-access";

export function SessionChrome({ access, children, detail = false, refresh }: {
  access: ReturnType<typeof useSessionAccess>; children: React.ReactNode; detail?: boolean; refresh?: () => void;
}) {
  const { theme, toggleTheme } = useTheme();
  const desktop = useDesktop();
  return <main className="dashboard-shell session-shell">
    <DashboardTopbar theme={theme} onThemeToggle={toggleTheme} onLogout={access.token ? access.logout : undefined}
      onRefresh={access.token && access.supported ? refresh : undefined} backHref={detail ? "/dashboard/sessions" : "/dashboard"} backLabel={detail ? "All sessions" : "Dashboard"} />
    {access.initialized && !access.token ? <section className="token-gate" aria-labelledby="token-title">
      <div className="token-gate-copy"><p className="eyebrow">Your session library</p><h1 id="token-title">Every step.<br />Yours.</h1><p>{desktop ? "Open Connection to reconnect your installed account." : "Sign in to explore your conversations, tools and ideas."}</p></div>
      <AccessTokenForm desktop={desktop} loading={false} value={access.tokenInput} onChange={access.setTokenInput} error={access.authError} onSubmit={access.signIn} />
    </section> : !access.supported ? <div className="session-main"><SessionEmpty title="A little update. A lot more detail." description="Update & restart in App settings to explore your sessions in this app." icon="refresh" /></div> : children}
  </main>;
}

export function SessionEmpty({ title, description, icon = "empty", action }: { title: string; description: string; icon?: "empty" | "error" | "refresh"; action?: React.ReactNode }) {
  const Icon = icon === "error" ? AlertCircle : icon === "refresh" ? RefreshCw : Inbox;
  return <section className="session-empty"><span className="session-empty-icon"><Icon size={25} strokeWidth={1.2} /></span><h2>{title}</h2><p>{description}</p>{action}</section>;
}

export function SessionError({ error, retry }: { error: ApiError; retry?: () => void }) {
  const gone = error.status === 410;
  return <SessionEmpty icon="error" title={gone ? "The details are no longer stored." : error.status === 404 ? "This item is unavailable." : error.status === 403 ? "This session is outside your access." : "We couldn’t load this yet."}
    description={gone ? "The retention period for this content has ended. Session metadata and any available process overview remain accessible." : error.status === 404 ? "The link may refer to a removed session or an earlier analysis." : error.message || "Check your connection and try again."}
    action={retry && ![403, 404, 410].includes(error.status) ? <button className="session-button" onClick={retry}><RefreshCw size={14} /> Try again</button> : undefined} />;
}

export function SessionBreadcrumb({ title }: { title?: string }) {
  return <div className="session-breadcrumb"><Link href="/dashboard/sessions"><ArrowLeft size={13} /> Sessions</Link>{title ? <><span>/</span><span>{title}</span></> : null}</div>;
}

export function SessionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className="session-text-link" href={href}>{children}<ArrowUpRight size={15} /></Link>;
}
