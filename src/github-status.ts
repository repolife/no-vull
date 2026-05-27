import { externalJson } from "./external-calls.js";

export type GithubComponentStatus =
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage"
  | "under_maintenance";

export interface GithubStatusSummary {
  indicator: string;
  description: string;
  updatedAt?: string;
  degradedComponents: Array<{
    name: string;
    status: GithubComponentStatus;
  }>;
  activeIncidents: Array<{
    name: string;
    status: string;
    impact: string;
    url?: string;
  }>;
}

interface GithubStatusApiResponse {
  page?: {
    updated_at?: string;
  };
  status?: {
    indicator?: string;
    description?: string;
  };
  components?: Array<{
    name?: string;
    status?: GithubComponentStatus;
    showcase?: boolean;
  }>;
  incidents?: Array<{
    name?: string;
    status?: string;
    impact?: string;
    shortlink?: string;
    resolved_at?: string | null;
  }>;
}

const GITHUB_STATUS_SUMMARY_URL = "https://www.githubstatus.com/api/v2/summary.json";

export function isGithubStatusDegraded(status: GithubStatusSummary): boolean {
  return status.indicator !== "none" ||
    status.degradedComponents.length > 0 ||
    status.activeIncidents.length > 0;
}

export async function checkGithubStatus(): Promise<GithubStatusSummary | null> {
  try {
    const data = await externalJson<GithubStatusApiResponse>({
      service: "github",
      operation: "status summary",
      url: GITHUB_STATUS_SUMMARY_URL,
      init: { headers: { Accept: "application/json" } },
      timeoutMs: 5_000,
    });

    const degradedComponents = (data.components ?? [])
      .filter((component) => component.showcase !== false)
      .filter((component) => component.status && component.status !== "operational")
      .map((component) => ({
        name: component.name ?? "Unknown component",
        status: component.status as GithubComponentStatus,
      }));

    const activeIncidents = (data.incidents ?? [])
      .filter((incident) => !incident.resolved_at)
      .map((incident) => ({
        name: incident.name ?? "GitHub incident",
        status: incident.status ?? "unknown",
        impact: incident.impact ?? "unknown",
        url: incident.shortlink,
      }));

    return {
      indicator: data.status?.indicator ?? "unknown",
      description: data.status?.description ?? "Unknown GitHub status",
      updatedAt: data.page?.updated_at,
      degradedComponents,
      activeIncidents,
    };
  } catch {
    return null;
  }
}
