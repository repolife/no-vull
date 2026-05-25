import Anthropic from "@anthropic-ai/sdk";
import type { AuditReport } from "./scanner.js";
import type { OsvFinding } from "./osv.js";
import type { DependentCounts } from "./viral.js";
import { externalOperation, streamNdjsonText, streamSseJsonText } from "./external-calls.js";

export type Provider = "claude" | "ollama" | "gemini" | "openai" | "lmstudio";

export interface ProviderOptions {
  provider: Provider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

const SYSTEM_PROMPT = `You are a security expert specializing in npm package vulnerabilities. Analyze npm audit results and provide:

1. Plain-English explanation of each vulnerability — what it is, how it could be exploited, who is affected
2. Severity assessment with real-world context (not just CVSS scores)
3. Concrete remediation steps — specific npm commands, version pins, or code changes
4. Prioritized action plan ordered by actual exploitability risk

Be direct and actionable. Respond ONLY with valid JSON matching this exact structure:
{
  "summary": "one paragraph executive summary",
  "totalVulnerabilities": <number>,
  "actionPlan": ["step 1", "step 2"],
  "vulnerabilities": [
    {
      "package": "package-name",
      "severity": "critical|high|moderate|low|info",
      "explanation": "plain english explanation",
      "exploitability": "low|medium|high",
      "remediation": "what to do",
      "command": "npm command if applicable (optional)"
    }
  ]
}`;

export interface VulnerabilityAnalysis {
  package: string;
  severity: string;
  explanation: string;
  exploitability: "low" | "medium" | "high";
  remediation: string;
  command?: string;
}

export interface AgentReport {
  summary: string;
  totalVulnerabilities: number;
  actionPlan: string[];
  vulnerabilities: VulnerabilityAnalysis[];
}

const responseSchema = {
  type: "object" as const,
  properties: {
    summary: { type: "string" },
    totalVulnerabilities: { type: "number" },
    actionPlan: { type: "array", items: { type: "string" } },
    vulnerabilities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          package: { type: "string" },
          severity: { type: "string" },
          explanation: { type: "string" },
          exploitability: { type: "string", enum: ["low", "medium", "high"] },
          remediation: { type: "string" },
          command: { type: "string" },
        },
        required: ["package", "severity", "explanation", "exploitability", "remediation"],
      },
    },
  },
  required: ["summary", "totalVulnerabilities", "actionPlan", "vulnerabilities"],
};

function buildUserMessage(report: AuditReport, osvFindings: OsvFinding[], dependentCounts: DependentCounts): string {
  let msg = `Analyze this npm audit report and provide a structured security assessment in JSON:\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``;

  if (osvFindings.length > 0) {
    const osvSummary = osvFindings.map((f) => ({
      package: f.packageName,
      version: f.version,
      advisories: f.vulnerabilities.map((v) => ({
        id: v.id,
        summary: v.summary,
        aliases: v.aliases,
        severity: v.severity,
      })),
    }));
    msg += `\n\nAdditional findings from OSV.dev (may include supply-chain or newly disclosed vulns not yet in npm audit):\n\n\`\`\`json\n${JSON.stringify(osvSummary, null, 2)}\n\`\`\``;
  }

  if (dependentCounts.size > 0) {
    const impact = Object.fromEntries(
      [...dependentCounts.entries()].map(([pkg, count]) => [pkg, `${count.toLocaleString()} dependent packages`])
    );
    msg += `\n\nDownstream blast radius (npm dependent package counts — factor this into severity and action plan priority):\n\n\`\`\`json\n${JSON.stringify(impact, null, 2)}\n\`\`\``;
  }

  return msg;
}

// --- Claude (Anthropic SDK, streaming + prompt caching + structured output) ---
async function analyzeWithClaude(
  report: AuditReport,
  osvFindings: OsvFinding[],
  dependentCounts: DependentCounts,
  model: string,
  onChunk: (text: string) => void
): Promise<AgentReport> {
  const fullText = await externalOperation({ service: "llm", operation: "Claude message stream" }, async () => {
    const client = new Anthropic();

    const stream = client.beta.messages.stream({
      model,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: buildUserMessage(report, osvFindings, dependentCounts) }],
      output_config: {
        format: {
          type: "json_schema",
          name: "security_report",
          schema: responseSchema,
          strict: true,
        },
      },
    });

    let text = "";
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        onChunk(event.delta.text);
        text += event.delta.text;
      }
    }
    return text;
  });

  return JSON.parse(fullText) as AgentReport;
}

// --- OpenAI-compatible streaming (OpenAI, Codex, any OpenAI-compatible endpoint) ---
async function analyzeWithOpenAI(
  report: AuditReport,
  osvFindings: OsvFinding[],
  dependentCounts: DependentCounts,
  model: string,
  baseUrl: string,
  apiKey: string,
  onChunk: (text: string) => void
): Promise<AgentReport> {
  const fullText = await streamSseJsonText<{
    choices?: Array<{ delta?: { content?: string } }>;
  }>({
    service: "llm",
    operation: "OpenAI chat completion",
    url: `${baseUrl}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(report, osvFindings, dependentCounts) },
        ],
      }),
    },
    extractText: (data) => data.choices?.[0]?.delta?.content,
    onChunk,
  });

  return JSON.parse(fullText) as AgentReport;
}

// --- Google Gemini (streaming via REST) ---
async function analyzeWithGemini(
  report: AuditReport,
  osvFindings: OsvFinding[],
  dependentCounts: DependentCounts,
  model: string,
  apiKey: string,
  onChunk: (text: string) => void
): Promise<AgentReport> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const fullText = await streamSseJsonText<{
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  }>({
    service: "llm",
    operation: "Gemini content generation",
    url,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildUserMessage(report, osvFindings, dependentCounts) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        },
      }),
    },
    extractText: (data) => data.candidates?.[0]?.content?.parts?.[0]?.text,
    onChunk,
  });

  return JSON.parse(fullText) as AgentReport;
}

// --- Ollama (local, streaming) ---
async function analyzeWithOllama(
  report: AuditReport,
  osvFindings: OsvFinding[],
  dependentCounts: DependentCounts,
  model: string,
  baseUrl: string,
  onChunk: (text: string) => void
): Promise<AgentReport> {
  const fullText = await streamNdjsonText<{
    message?: { content: string };
  }>({
    service: "llm",
    operation: "Ollama chat",
    url: `${baseUrl}/api/chat`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        format: "json",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(report, osvFindings, dependentCounts) },
        ],
      }),
    },
    extractText: (data) => data.message?.content,
    onChunk,
  });

  return JSON.parse(fullText) as AgentReport;
}

// --- Public entry point ---
export async function analyzeVulnerabilities(
  report: AuditReport,
  osvFindings: OsvFinding[],
  onChunk: (text: string) => void,
  options: ProviderOptions = { provider: "claude" },
  dependentCounts: DependentCounts = new Map()
): Promise<AgentReport> {
  const { provider, baseUrl, apiKey } = options;

  switch (provider) {
    case "claude":
      return analyzeWithClaude(report, osvFindings, dependentCounts, options.model ?? "claude-sonnet-4-6", onChunk);

    case "openai":
      return analyzeWithOpenAI(
        report, osvFindings, dependentCounts,
        options.model ?? "gpt-4o",
        baseUrl ?? "https://api.openai.com/v1",
        apiKey ?? process.env.OPENAI_API_KEY ?? "",
        onChunk
      );

    case "gemini":
      return analyzeWithGemini(
        report, osvFindings, dependentCounts,
        options.model ?? "gemini-2.0-flash",
        apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "",
        onChunk
      );

    case "lmstudio":
      return analyzeWithOpenAI(
        report, osvFindings, dependentCounts,
        options.model ?? "local-model",
        baseUrl ?? "http://localhost:1234/v1",
        apiKey ?? "lm-studio",
        onChunk
      );

    case "ollama":
      return analyzeWithOllama(
        report, osvFindings, dependentCounts,
        options.model ?? "llama3.2",
        baseUrl ?? "http://localhost:11434",
        onChunk
      );
  }
}
