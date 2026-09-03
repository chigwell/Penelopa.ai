const GITHUB_REPO_API_URL = "https://api.github.com/repos/chigwell/penelopa.ai";
const GITHUB_REPO_URL = "https://github.com/chigwell/penelopa.ai";
const GITHUB_REPO_NAME = "chigwell/penelopa.ai";
const CACHE_TTL_SECONDS = 3600;
const CACHE_CONTROL = `public, max-age=300, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`;

type GitHubRepoStats = {
  full_name: string;
  html_url: string;
  stargazers_count: number;
  generated_at: string;
  cache_ttl_seconds: number;
};

type GitHubRepoPayload = {
  stargazers_count: number;
};

function isGitHubRepoPayload(value: unknown): value is GitHubRepoPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.stargazers_count === "number";
}

export async function GET() {
  try {
    const upstream = await fetch(GITHUB_REPO_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!upstream.ok) {
      return Response.json(
        { error: "GitHub repo stats are temporarily unavailable." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const payload: unknown = await upstream.json();
    if (!isGitHubRepoPayload(payload)) {
      return Response.json(
        { error: "GitHub repo stats returned an unexpected shape." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const repoStats: GitHubRepoStats = {
      full_name: GITHUB_REPO_NAME,
      html_url: GITHUB_REPO_URL,
      stargazers_count: payload.stargazers_count,
      generated_at: new Date().toISOString(),
      cache_ttl_seconds: CACHE_TTL_SECONDS,
    };

    return Response.json(repoStats, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch {
    return Response.json(
      { error: "GitHub repo stats are temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
