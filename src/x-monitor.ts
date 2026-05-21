import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface XAlert {
  packageName: string;
  tweets: XTweet[];
}

export interface XTweet {
  id: string;
  text: string;
  author: string;
  createdAt: string;
  url: string;
  likeCount: number;
  retweetCount: number;
}

interface TwitterSearchResponse {
  data?: Array<{
    id: string;
    text: string;
    author_id: string;
    created_at: string;
    public_metrics: {
      like_count: number;
      retweet_count: number;
      reply_count: number;
    };
  }>;
  includes?: {
    users?: Array<{ id: string; username: string; name: string }>;
  };
  meta?: { result_count: number };
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readDirectDeps(repoPath: string): string[] {
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) return [];

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as PackageJson;
  } catch {
    return [];
  }

  const deps = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];

  // Strip version specifiers, keep unique
  return [...new Set(deps)];
}

const SECURITY_KEYWORDS = [
  "vulnerability",
  "vuln",
  "CVE",
  "hack",
  "hacked",
  "compromised",
  "malware",
  "malicious",
  "supply chain",
  "security issue",
  "backdoor",
  "exploit",
  "RCE",
  "XSS",
  "injection",
  "don't update",
  "do not update",
  "yanked",
  "unpublished",
];

async function searchPackageAlerts(
  packageName: string,
  bearerToken: string
): Promise<XTweet[]> {
  const keywordQuery = SECURITY_KEYWORDS.slice(0, 6)
    .map((k) => `"${k}"`)
    .join(" OR ");

  // X API requires exact package name in quotes, combined with security terms
  const query = `"${packageName}" (${keywordQuery}) -is:retweet lang:en`;

  const params = new URLSearchParams({
    query,
    max_results: "10",
    "tweet.fields": "created_at,author_id,public_metrics",
    expansions: "author_id",
    "user.fields": "username",
    start_time: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const res = await fetch(
    `https://api.twitter.com/2/tweets/search/recent?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
      signal: AbortSignal.timeout(10000),
    }
  );

  if (res.status === 429) {
    // Rate limited — skip silently
    return [];
  }

  if (!res.ok) {
    throw new Error(`X API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as TwitterSearchResponse;
  if (!data.data || data.data.length === 0) return [];

  const userMap = new Map(
    (data.includes?.users ?? []).map((u) => [u.id, u.username])
  );

  return data.data
    .map((tweet) => ({
      id: tweet.id,
      text: tweet.text,
      author: userMap.get(tweet.author_id) ?? tweet.author_id,
      createdAt: tweet.created_at,
      url: `https://x.com/i/web/status/${tweet.id}`,
      likeCount: tweet.public_metrics.like_count,
      retweetCount: tweet.public_metrics.retweet_count,
    }))
    .filter(
      // Only surface tweets with some engagement — filters out noise
      (t) => t.likeCount + t.retweetCount >= 2
    )
    .sort((a, b) => b.likeCount + b.retweetCount - (a.likeCount + a.retweetCount));
}

export async function checkXAlerts(
  repoPath: string,
  bearerToken: string,
  onProgress?: (done: number, total: number) => void
): Promise<XAlert[]> {
  const deps = readDirectDeps(repoPath);
  if (deps.length === 0) return [];

  const alerts: XAlert[] = [];
  let done = 0;

  // Search direct deps only — transitive would exhaust rate limits fast
  // X free tier: 500k tweets/month read, ~1 req/sec
  const CONCURRENCY = 2;
  for (let i = 0; i < deps.length; i += CONCURRENCY) {
    const batch = deps.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (pkg) => {
        try {
          const tweets = await searchPackageAlerts(pkg, bearerToken);
          if (tweets.length > 0) {
            alerts.push({ packageName: pkg, tweets });
          }
        } catch {
          // Skip packages that error — don't abort the whole scan
        }
        done++;
        onProgress?.(done, deps.length);
      })
    );
    // Respect rate limits — X free tier allows ~1 req/sec on search
    if (i + CONCURRENCY < deps.length) {
      await new Promise((r) => setTimeout(r, 1100));
    }
  }

  return alerts;
}

export function formatXAlerts(alerts: XAlert[]): string {
  if (alerts.length === 0) return "";

  const lines: string[] = [
    `X/Twitter: security chatter found for ${alerts.length} package(s) in last 7 days:\n`,
  ];

  for (const alert of alerts) {
    lines.push(`  ${alert.packageName} — ${alert.tweets.length} alert(s)`);
    for (const tweet of alert.tweets.slice(0, 2)) {
      const age = Math.round(
        (Date.now() - new Date(tweet.createdAt).getTime()) / (1000 * 60 * 60)
      );
      const engagementLabel = `${tweet.likeCount}♥ ${tweet.retweetCount}↺`;
      lines.push(`    @${tweet.author} · ${age}h ago · ${engagementLabel}`);
      // Truncate long tweet text
      const text = tweet.text.length > 120 ? tweet.text.slice(0, 117) + "..." : tweet.text;
      lines.push(`    "${text}"`);
      lines.push(`    ${tweet.url}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
