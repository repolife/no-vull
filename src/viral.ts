import { externalJson } from "./external-calls.js";

export type DependentCounts = Map<string, number>;

async function fetchDependentCount(name: string): Promise<number> {
  try {
    const data = await externalJson<{ total?: number }>({
      service: "npm",
      operation: "dependent count search",
      url: `https://registry.npmjs.org/-/v1/search?text=dependencies:${encodeURIComponent(name)}&size=1`,
      init: { headers: { Accept: "application/json" } },
      timeoutMs: 6_000,
    });
    return data.total ?? 0;
  } catch {
    return 0;
  }
}

export async function fetchDependentCounts(packageNames: string[]): Promise<DependentCounts> {
  const counts = new Map<string, number>();
  await Promise.all(
    packageNames.map(async (name) => {
      counts.set(name, await fetchDependentCount(name));
    })
  );
  return counts;
}

export function formatDependentCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n > 0 ? String(n) : "—";
}
