export type ExternalService = "github" | "llm" | "npm" | "osv" | "twitter" | "webhook";

interface ExternalFetchOptions {
  service: ExternalService;
  operation: string;
  url: string;
  init?: RequestInit;
  timeoutMs?: number;
  allowedStatuses?: number[];
}

interface ExternalOperationOptions {
  service: ExternalService;
  operation: string;
}

interface StreamJsonTextOptions<T> extends ExternalFetchOptions {
  extractText: (data: T) => string | undefined;
  onChunk: (text: string) => void;
  doneValue?: string;
}

function withTimeout(init: RequestInit | undefined, timeoutMs: number): RequestInit {
  if (init?.signal) return init;
  return { ...init, signal: AbortSignal.timeout(timeoutMs) };
}

async function errorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}

export async function externalOperation<T>(
  { service, operation }: ExternalOperationOptions,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`${service} ${operation} failed: ${error.message}`, { cause: error });
    }
    throw new Error(`${service} ${operation} failed`);
  }
}

export async function externalFetch({
  service,
  operation,
  url,
  init,
  timeoutMs = 30_000,
  allowedStatuses = [],
}: ExternalFetchOptions): Promise<Response> {
  const response = await fetch(url, withTimeout(init, timeoutMs));

  if (!response.ok && !allowedStatuses.includes(response.status)) {
    throw new Error(`${service} ${operation} failed: ${response.status} ${await errorBody(response)}`);
  }

  return response;
}

export async function externalJson<T>(options: ExternalFetchOptions): Promise<T> {
  const response = await externalFetch(options);
  return (await response.json()) as T;
}

export async function streamSseJsonText<T>({
  service,
  operation,
  url,
  init,
  timeoutMs,
  extractText,
  onChunk,
  doneValue = "[DONE]",
}: StreamJsonTextOptions<T>): Promise<string> {
  const response = await externalFetch({ service, operation, url, init, timeoutMs });
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${service} ${operation} failed: no response body`);

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const processLine = (line: string): void => {
    if (!line.startsWith("data: ")) return;

    const data = line.slice(6).trim();
    if (!data || data === doneValue) return;

    try {
      const parsed = JSON.parse(data) as T;
      const text = extractText(parsed);
      if (!text) return;
      onChunk(text);
      fullText += text;
    } catch {
      // Ignore incomplete or non-JSON stream events.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line.trim());
  }

  if (buffer.trim()) processLine(buffer.trim());

  return fullText;
}

export async function streamNdjsonText<T>({
  service,
  operation,
  url,
  init,
  timeoutMs,
  extractText,
  onChunk,
}: StreamJsonTextOptions<T>): Promise<string> {
  const response = await externalFetch({ service, operation, url, init, timeoutMs });
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${service} ${operation} failed: no response body`);

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const processLine = (line: string): void => {
    if (!line) return;
    try {
      const parsed = JSON.parse(line) as T;
      const text = extractText(parsed);
      if (!text) return;
      onChunk(text);
      fullText += text;
    } catch {
      // Ignore incomplete stream lines.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line.trim());
  }

  if (buffer.trim()) processLine(buffer.trim());

  return fullText;
}
