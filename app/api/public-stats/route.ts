const PUBLIC_STATS_URL = "https://api.penelopa.ai/v1/public/stats/summary";
const CACHE_CONTROL = "public, max-age=30, s-maxage=30";

type PublicStatsCounters = {
  total_tokens: number;
  messages_count: number;
  recommendations_count: number;
};

type PublicStatsSummary = {
  all_time: PublicStatsCounters;
  last_24h: PublicStatsCounters;
  generated_at: string;
  cache_ttl_seconds: number;
};

function isCounter(value: unknown): value is PublicStatsCounters {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.total_tokens === "number" &&
    typeof candidate.messages_count === "number" &&
    typeof candidate.recommendations_count === "number"
  );
}

function isPublicStatsSummary(value: unknown): value is PublicStatsSummary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isCounter(candidate.all_time) &&
    isCounter(candidate.last_24h) &&
    typeof candidate.generated_at === "string" &&
    typeof candidate.cache_ttl_seconds === "number"
  );
}

export async function GET() {
  try {
    const upstream = await fetch(PUBLIC_STATS_URL, {
      headers: { Accept: "application/json" },
    });

    if (!upstream.ok) {
      return Response.json(
        { error: "Public stats are temporarily unavailable." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const payload: unknown = await upstream.json();
    if (!isPublicStatsSummary(payload)) {
      return Response.json(
        { error: "Public stats returned an unexpected shape." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(payload, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch {
    return Response.json(
      { error: "Public stats are temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
