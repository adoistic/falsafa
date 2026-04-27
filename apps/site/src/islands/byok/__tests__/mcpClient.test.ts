/**
 * MCP client tests. The contract is "never throw" — every error path
 * returns a structured McpCallError so callers can await without try/catch.
 *
 * Five scenarios:
 *   1. 200 OK → ok=true with parsed output
 *   2. 4xx with JSON body → ok=false with error message + status
 *   3. 5xx with non-JSON body → ok=false with synthesized message
 *   4. fetch throws (network) → ok=false with error message
 *   5. makeOnToolCall: ok unwraps to output, error throws (AI SDK contract)
 */

import { describe, test, expect } from "bun:test";
import { createMcpClient, makeOnToolCall } from "../mcpClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function plainResponse(body: string, status = 500): Response {
  return new Response(body, { status });
}

describe("mcpClient.invoke", () => {
  test("200 OK returns ok=true with parsed output", async () => {
    const fetchMock = (async () => jsonResponse({ works: [{ slug: "test" }] })) as typeof fetch;
    const client = createMcpClient({ baseURL: "http://test", fetch: fetchMock });

    const result = await client.invoke("list_works", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ works: [{ slug: "test" }] });
    }
  });

  test("4xx with JSON error body returns structured error", async () => {
    const fetchMock = (async () =>
      jsonResponse({ error: "Unknown work slug" }, 404)) as typeof fetch;
    const client = createMcpClient({ baseURL: "http://test", fetch: fetchMock });

    const result = await client.invoke("read_chapter", { work_slug: "nonexistent" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Unknown work slug");
      expect(result.status).toBe(404);
    }
  });

  test("5xx with non-JSON body falls back to synthesized error", async () => {
    const fetchMock = (async () => plainResponse("Internal Server Error", 503)) as typeof fetch;
    const client = createMcpClient({ baseURL: "http://test", fetch: fetchMock });

    const result = await client.invoke("search_corpus", { query: "anything" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("MCP server returned 503");
      expect(result.status).toBe(503);
    }
  });

  test("fetch throws (network error) returns ok=false without re-throwing", async () => {
    const fetchMock = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const client = createMcpClient({ baseURL: "http://test", fetch: fetchMock });

    const result = await client.invoke("list_works", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Failed to fetch");
    }
  });

  test("URL-encodes the tool name", async () => {
    let capturedUrl = "";
    const fetchMock = (async (url: RequestInfo | URL) => {
      capturedUrl = String(url);
      return jsonResponse({});
    }) as typeof fetch;
    const client = createMcpClient({ baseURL: "http://test", fetch: fetchMock });

    await client.invoke("weird/tool name", {});
    expect(capturedUrl).toBe("http://test/tools/weird%2Ftool%20name");
  });

  test("strips trailing slash from baseURL", async () => {
    let capturedUrl = "";
    const fetchMock = (async (url: RequestInfo | URL) => {
      capturedUrl = String(url);
      return jsonResponse({});
    }) as typeof fetch;
    const client = createMcpClient({ baseURL: "http://test/", fetch: fetchMock });

    await client.invoke("list_works", {});
    expect(capturedUrl).toBe("http://test/tools/list_works");
  });

  test("sends JSON body with Content-Type header", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return jsonResponse({});
    }) as typeof fetch;
    const client = createMcpClient({ baseURL: "http://test", fetch: fetchMock });

    await client.invoke("get_passage", { work_slug: "ghalib", chapter_number: 168 });
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)?.["Content-Type"]).toBe(
      "application/json",
    );
    expect(capturedInit?.body).toBe(
      JSON.stringify({ work_slug: "ghalib", chapter_number: 168 }),
    );
  });
});

describe("makeOnToolCall (AI SDK contract)", () => {
  test("on success: returns the output", async () => {
    const fetchMock = (async () => jsonResponse({ result: "data" })) as typeof fetch;
    const client = createMcpClient({ baseURL: "http://test", fetch: fetchMock });
    const onToolCall = makeOnToolCall(client);

    const result = await onToolCall("list_works", {});
    expect(result).toEqual({ result: "data" });
  });

  test("on error: throws (AI SDK expects throw to surface tool errors)", async () => {
    const fetchMock = (async () => jsonResponse({ error: "bad input" }, 400)) as typeof fetch;
    const client = createMcpClient({ baseURL: "http://test", fetch: fetchMock });
    const onToolCall = makeOnToolCall(client);

    await expect(onToolCall("read_chapter", {})).rejects.toThrow(/Falsafa MCP error/);
  });
});
