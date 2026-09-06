export function formatMetric(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }
  return formatNumber(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: value >= 100_000 ? 1 : 0,
    notation: value >= 100_000 ? "compact" : "standard",
  }).format(value);
}

export function formatDelta(value: number | null | undefined) {
  return value === null || value === undefined
    ? "— / 24h"
    : `+${formatMetric(value)} / 24h`;
}

export function formatUpdated(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDay(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function formatDateTime(value: string, invalidLabel = "—") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return invalidLabel;
  }
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatPublicMetric(value: number | undefined) {
  if (value === undefined) {
    return "...";
  }

  return formatNumber(value);
}

export function formatStars(value: number | undefined) {
  if (value === undefined) {
    return "... stars";
  }

  return `${formatPublicMetric(value)} ${value === 1 ? "star" : "stars"}`;
}

export function formatGeneratedAt(value: string | undefined) {
  if (!value) {
    return "Updating";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Live";
  }

  return `Updated ${new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(date)}`;
}

