/**
 * MCP client — resolves tool calls from the BYOK demo.
 *
 * Per /plan-eng-review run 2 + design Q1 (hybrid), the BYOK demo's tool
 * calls go through an HTTP-wrapped Falsafa MCP server. In development
 * that's http://localhost:3001 running apps/mcp behind a tiny HTTP
 * adapter. At launch it'll be https://mcp.falsafa.app.
 *
 * The base URL is read from the page-level config (window.__FALSAFA_MCP_URL)
 * which the /try Astro page sets at build time. Falls back to the dev URL
 * for local development.
 *
 * Wire format: each tool is exposed as POST /tools/<tool_name> with a
 * JSON body of the tool's input. The server returns the tool's output
 * as JSON. Errors map to non-2xx status codes with { error: string }
 * bodies.
 *
 * If the BYOK demo is running on a host that hasn't deployed the remote
 * MCP yet, this client surfaces a clear error rather than hanging or
 * silently failing.
 */

const DEFAULT_DEV_URL = "http://localhost:3001";

export interface McpClientArgs {
  /** Override the base URL. Falls back to window-injected, then dev default. */
  baseURL?: string;
  /** Custom fetch (for tests). */
  fetch?: typeof globalThis.fetch;
}

export interface McpCallResult<T = unknown> {
  ok: true;
  output: T;
}

export interface McpCallError {
  ok: false;
  error: string;
  status?: number;
}

/**
 * Construct an MCP client. The returned object exposes a single
 * `invoke(toolName, args)` method that the BYOK provider adapter passes
 * as `onToolCall`.
 */
export function createMcpClient(args: McpClientArgs = {}) {
  const baseURL = resolveBaseURL(args.baseURL);
  const fetchImpl = args.fetch ?? globalThis.fetch;

  return {
    baseURL,

    /**
     * Invoke a Falsafa MCP tool. Returns the tool's parsed output on
     * success, or a structured error on failure. Never throws — callers
     * can safely await without try/catch.
     */
    async invoke(toolName: string, toolArgs: unknown): Promise<McpCallResult | McpCallError> {
      const url = `${baseURL}/tools/${encodeURIComponent(toolName)}`;
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toolArgs ?? {}),
        });

        if (!res.ok) {
          let errorBody: { error?: string } = {};
          try {
            errorBody = (await res.json()) as { error?: string };
          } catch {
            /* non-JSON body, leave errorBody empty */
          }
          return {
            ok: false,
            error: errorBody.error ?? `MCP server returned ${res.status}`,
            status: res.status,
          };
        }

        const output = await res.json();
        return { ok: true, output };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

/**
 * Resolve the MCP base URL. Priority:
 *   1. Caller-provided override
 *   2. window.__FALSAFA_MCP_URL (set by /try Astro page at build time)
 *   3. import.meta.env.PUBLIC_FALSAFA_MCP_URL (Vite env var)
 *   4. DEFAULT_DEV_URL
 */
function resolveBaseURL(override?: string): string {
  if (override) return override.replace(/\/$/, "");

  if (typeof window !== "undefined") {
    const fromWindow = (window as unknown as { __FALSAFA_MCP_URL?: string })
      .__FALSAFA_MCP_URL;
    if (fromWindow) return fromWindow.replace(/\/$/, "");
  }

  if (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env) {
    const fromVite = (import.meta as { env: Record<string, string> }).env
      .PUBLIC_FALSAFA_MCP_URL;
    if (fromVite) return fromVite.replace(/\/$/, "");
  }

  return DEFAULT_DEV_URL;
}

/**
 * Convenience: build an `onToolCall` callback ready to pass to a
 * provider adapter. Wraps `invoke` so the result is the unwrapped
 * output or a thrown error (the AI SDK's tool execution expects either
 * a returned value or a throw).
 */
export function makeOnToolCall(
  client: ReturnType<typeof createMcpClient>,
): (name: string, args: unknown) => Promise<unknown> {
  return async (name, args) => {
    const result = await client.invoke(name, args);
    if (result.ok) return result.output;
    throw new Error(`Falsafa MCP error (${name}): ${result.error}`);
  };
}
