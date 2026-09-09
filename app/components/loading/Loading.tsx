import type { CSSProperties, ReactNode } from "react";

export function Skeleton({ className = "", width, height }: {
  className?: string;
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
}) {
  return <span className={`skeleton ${className}`} style={{ width, height }} aria-hidden="true" />;
}

export function LoadingStatus({ children = "Loading…" }: { children?: ReactNode }) {
  return <span className="loading-status" role="status"><span className="loading-status-dot" aria-hidden="true" />{children}</span>;
}

function LoadingRegion({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={`loading-region ${className}`} aria-busy="true" aria-label={label}>
    <span className="sr-only" role="status">{label}</span>
    {children}
  </div>;
}

export function SessionListSkeleton({ rows = 5 }: { rows?: number }) {
  return <LoadingRegion label="Loading sessions" className="session-list-skeleton">
    {Array.from({ length: rows }, (_, index) => <div className="session-skeleton-row" key={index}>
      <Skeleton className="skeleton-avatar" />
      <div className="skeleton-stack"><Skeleton width={`${68 - index % 3 * 12}%`} height={18} /><Skeleton width="43%" height={12} /></div>
      <Skeleton className="skeleton-row-meta" width={72} height={12} />
    </div>)}
  </LoadingRegion>;
}

export function TimelineSkeleton({ rows = 6 }: { rows?: number }) {
  return <LoadingRegion label="Loading session events" className="timeline-skeleton">
    {Array.from({ length: rows }, (_, index) => <div className="timeline-skeleton-row" key={index}>
      <Skeleton className="skeleton-avatar" />
      <div className="skeleton-stack"><Skeleton width={96} height={11} /><Skeleton width={`${86 - index % 3 * 13}%`} height={16} /><Skeleton width="53%" height={12} /></div>
    </div>)}
  </LoadingRegion>;
}

export function DetailSkeleton({ compact = false }: { compact?: boolean }) {
  return <LoadingRegion label="Loading details" className={`detail-skeleton${compact ? " is-compact" : ""}`}>
    <Skeleton width="27%" height={12} /><Skeleton width="68%" height={compact ? 24 : 36} />
    <div className="skeleton-stack">{[96, 89, 97, 62].map((width, index) => <Skeleton key={index} width={`${width}%`} height={14} />)}</div>
    <Skeleton className="skeleton-code" height={compact ? 92 : 170} />
    {!compact && <div className="skeleton-stack"><Skeleton width="87%" height={14} /><Skeleton width="64%" height={14} /></div>}
  </LoadingRegion>;
}

export function RecommendationSkeleton() {
  return <LoadingRegion label="Loading recommendation" className="recommendation-page-skeleton">
    <Skeleton width={120} height={12} /><Skeleton width="78%" height={64} /><Skeleton width="55%" height={14} />
    <Skeleton width={184} height={38} /><DetailSkeleton />
  </LoadingRegion>;
}

export function NotificationsSkeleton({ compact = false }: { compact?: boolean }) {
  return <LoadingRegion label="Loading notification settings" className={`notifications-skeleton${compact ? " is-compact" : ""}`}>
    <div className="skeleton-stack"><Skeleton width="62%" height={18} /><Skeleton width="82%" height={14} />
      <div className="skeleton-summary-grid">{[0, 1, 2].map(index => <div className="skeleton-stack" key={index}><Skeleton width="70%" height={10} /><Skeleton width="90%" height={18} /></div>)}</div>
    </div>
    {!compact && <div className="skeleton-stack"><Skeleton width={210} height={42} /><Skeleton height={72} /><Skeleton height={72} /><Skeleton width={140} height={38} /></div>}
  </LoadingRegion>;
}

export function DashboardSkeleton() {
  return <LoadingRegion label="Loading dashboard" className="dashboard-skeleton">
    <div className="dashboard-title-skeleton skeleton-stack"><Skeleton width={126} height={12} /><Skeleton width="min(480px, 85%)" height={80} /></div>
    <div className="total-cards">{Array.from({ length: 5 }, (_, index) => <div className="total-card" key={index}><Skeleton width={76} height={12} /><Skeleton width="72%" height={55} /><Skeleton width={82} height={12} /></div>)}</div>
    <div className="skeleton-panel"><Skeleton width={210} height={34} /><SessionListSkeleton /></div>
    <div className="skeleton-panel"><Skeleton width={170} height={34} /><Skeleton className="skeleton-chart" height={280} /></div>
  </LoadingRegion>;
}
