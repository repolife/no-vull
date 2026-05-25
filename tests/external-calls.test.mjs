import test from "node:test";
import assert from "node:assert/strict";
import {
  externalFetch,
  externalJson,
  streamNdjsonText,
  streamSseJsonText,
} from "../dist/external-calls.js";

const originalFetch = globalThis.fetch;

function mockFetch(responseFactory) {
  globalThis.fetch = async (...args) => responseFactory(...args);
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function streamResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200 }
  );
}

test("externalJson returns parsed JSON for successful responses", async () => {
  mockFetch(() => Response.json({ ok: true }));

  const data = await externalJson({
    service: "npm",
    operation: "package metadata",
    url: "https://registry.npmjs.org/chalk",
  });

  assert.deepEqual(data, { ok: true });
});

test("externalFetch throws service and operation context for failed responses", async () => {
  mockFetch(() => new Response("nope", { status: 500 }));

  await assert.rejects(
    externalFetch({
      service: "osv",
      operation: "batch query",
      url: "https://api.osv.dev/v1/querybatch",
    }),
    /osv batch query failed: 500 nope/
  );
});

test("externalFetch can return allowed non-OK statuses", async () => {
  mockFetch(() => new Response("", { status: 429 }));

  const response = await externalFetch({
    service: "twitter",
    operation: "recent search",
    url: "https://api.twitter.com/2/tweets/search/recent",
    allowedStatuses: [429],
  });

  assert.equal(response.status, 429);
});

test("streamSseJsonText assembles text across partial SSE chunks", async () => {
  mockFetch(() =>
    streamResponse([
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
      "data: [DONE]\n",
    ])
  );

  const chunks = [];
  const text = await streamSseJsonText({
    service: "llm",
    operation: "OpenAI chat completion",
    url: "https://example.test/chat",
    extractText: (data) => data.choices?.[0]?.delta?.content,
    onChunk: (chunk) => chunks.push(chunk),
  });

  assert.equal(text, "hello");
  assert.deepEqual(chunks, ["hel", "lo"]);
});

test("streamNdjsonText assembles text across NDJSON chunks", async () => {
  mockFetch(() =>
    streamResponse([
      '{"message":{"content":"he"}}\n',
      '{"message":{"content":"llo"}}\n',
    ])
  );

  const chunks = [];
  const text = await streamNdjsonText({
    service: "llm",
    operation: "Ollama chat",
    url: "https://example.test/chat",
    extractText: (data) => data.message?.content,
    onChunk: (chunk) => chunks.push(chunk),
  });

  assert.equal(text, "hello");
  assert.deepEqual(chunks, ["he", "llo"]);
});
