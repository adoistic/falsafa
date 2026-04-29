/**
 * ByokDemo — top-level Preact island for the /try BYOK demo.
 *
 * Owns the state machine via useReducer, wires the form components to
 * the reducer, and drives the provider adapter on submit. The result is
 * a single component that any Astro page can mount with client:load.
 *
 * Streaming text re-renders happen on every TEXT_DELTA dispatch; the
 * rAF coalescing optimization (Phase 2 Checkpoint 7) wraps the dispatch
 * in a useStreaming hook later. For Checkpoint 5 we render naively;
 * functional correctness first, then perf.
 */

import { useEffect, useReducer, useState } from "preact/hooks";
import type { JSX } from "preact";
import "../../styles/tool-trace.css";
import { initialState, reducer, canSubmit, PROVIDERS } from "./state";
import type { Provider, BYOKAction, BYOKState } from "./types";
import {
  loadKey,
  saveKey,
  forgetKey,
  loadProvider,
  saveProvider,
  loadModel,
  saveModel,
} from "./storage";
import { loadAdapter } from "./providers";
import { dispatchTool } from "./browserTools";
import { DEFAULT_MODEL_BY_PROVIDER } from "./models";
import KeyInput from "./ui/KeyInput";
import ProviderPicker from "./ui/ProviderPicker";
import ModelPicker from "./ui/ModelPicker";
import QuestionInput from "./ui/QuestionInput";
import StreamingOutput from "./ui/StreamingOutput";
import ErrorBanner from "./ui/ErrorBanner";

interface Props {
  /**
   * Suggested questions shown as chips beneath the textarea. The /try
   * page passes ~12 hand-picked prompts; later this becomes a random
   * sample from the eval pool.
   */
  chips?: string[];
}

const FALLBACK_CHIPS = [
  "What does Ghalib's couplet 168 say about love?",
  "Compare Iqbal and Ghalib on the role of suffering.",
  "Which works in the corpus discuss the soul's journey after death?",
  "Show me the opening lines of Cynewulf's Andreas.",
];

export default function ByokDemo({ chips = FALLBACK_CHIPS }: Props): JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const storedKey = loadKey();
    const storedProvider = loadProvider() as Provider | null;
    const storedModel = loadModel();
    // Build the seed: anything stored wins, otherwise fall through to the
    // defaults baked into initialState (currently OpenRouter + Claude
    // Sonnet 4.5, since OpenRouter is the only provider that supports
    // browser-direct chat completions for everyone).
    const seed: Partial<BYOKState> = {};
    if (storedKey) seed.apiKey = storedKey;
    if (storedKey) seed.rememberKey = true;
    if (storedProvider) {
      seed.provider = storedProvider;
      seed.modelId = storedModel ?? DEFAULT_MODEL_BY_PROVIDER[storedProvider];
    } else if (storedModel) {
      seed.modelId = storedModel;
    }
    return initialState(seed);
  });
  const [hasStored, setHasStored] = useState(() => !!loadKey());

  // Persist provider + model on every change.
  useEffect(() => {
    saveProvider(state.provider);
  }, [state.provider]);

  useEffect(() => {
    saveModel(state.modelId);
  }, [state.modelId]);

  const inFlight = state.status === "submitting" || state.status === "streaming";
  const submitGate = canSubmit(state) === null;

  function handleSubmit() {
    if (!submitGate) return;

    if (state.rememberKey) {
      saveKey(state.apiKey);
      setHasStored(true);
    }

    const ac = new AbortController();
    dispatch({ type: "SUBMIT", abortController: ac });
    void runStream(state.provider, {
      provider: state.provider,
      apiKey: state.apiKey,
      modelId: state.modelId,
      question: state.question,
      abortSignal: ac.signal,
      dispatch,
    });
  }

  function handleAbort() {
    state.abortController?.abort();
    dispatch({ type: "USER_ABORT" });
  }

  function handleForget() {
    forgetKey();
    setHasStored(false);
    dispatch({ type: "FORGET_KEY" });
  }

  return (
    <div class="byok-demo">
      <div class="byok-form">
        <ProviderPicker
          value={state.provider}
          onChange={(p) =>
            dispatch({
              type: "PROVIDER_CHANGED",
              provider: p,
              defaultModelId: DEFAULT_MODEL_BY_PROVIDER[p],
            })
          }
          disabled={inFlight}
        />

        {/* key={state.provider} forces a fresh component instance on provider
            switch so the per-provider cached model list and any open
            combobox state reset cleanly. */}
        <ModelPicker
          key={state.provider}
          provider={state.provider}
          apiKey={state.apiKey}
          value={state.modelId}
          onChange={(m) => dispatch({ type: "MODEL_CHANGED", modelId: m })}
          disabled={inFlight}
        />

        <KeyInput
          value={state.apiKey}
          remember={state.rememberKey}
          hasStored={hasStored}
          onChange={(k) => dispatch({ type: "KEY_CHANGED", key: k })}
          onRememberToggle={(r) => dispatch({ type: "REMEMBER_TOGGLED", remember: r })}
          onForget={handleForget}
          disabled={inFlight}
        />

        <QuestionInput
          value={state.question}
          onChange={(q) => dispatch({ type: "QUESTION_CHANGED", question: q })}
          onSubmit={handleSubmit}
          onAbort={handleAbort}
          inFlight={inFlight}
          canSubmit={submitGate}
          chips={chips}
          onPickChip={(q) => dispatch({ type: "QUESTION_CHANGED", question: q })}
        />
      </div>

      <StreamingOutput state={state} />

      {state.error !== null && (state.status !== "streaming" && state.status !== "submitting") && (
        <ErrorBanner
          error={state.error}
          onRetry={() => dispatch({ type: "RETRY" })}
          onNewQuestion={() => dispatch({ type: "NEW_QUESTION" })}
        />
      )}
    </div>
  );
}

/**
 * Drive the provider adapter and dispatch normalized events. Lives outside
 * the component to keep the render path pure. Errors caught here become
 * ERROR actions on the reducer.
 */
async function runStream(
  provider: Provider,
  args: {
    provider: Provider;
    apiKey: string;
    modelId: string;
    question: string;
    abortSignal: AbortSignal;
    dispatch: (action: BYOKAction) => void;
  },
): Promise<void> {
  try {
    const stream = await loadAdapter(provider);
    // Browser-bundled MCP dispatch: tool calls run directly in the page
    // against /corpus/* static URLs. No server hop, no CORS, no key
    // beyond what the user already typed for the LLM provider.
    const onToolCall = dispatchTool;

    let firstChunkSeen = false;
    for await (const evt of stream({
      provider: args.provider,
      apiKey: args.apiKey,
      modelId: args.modelId,
      question: args.question,
      abortSignal: args.abortSignal,
      onToolCall,
    })) {
      if (!firstChunkSeen && evt.kind !== "error") {
        firstChunkSeen = true;
        args.dispatch({ type: "FIRST_CHUNK" });
      }
      mapToAction(evt, args.dispatch);
    }
  } catch (err) {
    args.dispatch({
      type: "ERROR",
      error: {
        kind: "network-disconnect",
        provider: args.provider,
        cause: "fetch-error",
        underlying: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

function mapToAction(
  evt: import("./types").NormalizedEvent,
  dispatch: (action: BYOKAction) => void,
): void {
  switch (evt.kind) {
    case "text-delta":
      dispatch({ type: "TEXT_DELTA", delta: evt.delta });
      break;
    case "tool-call-start":
      dispatch({
        type: "TOOL_CALL_START",
        id: evt.id,
        name: evt.name,
        argsPreview: evt.argsPreview,
      });
      break;
    case "tool-call-arg-delta":
      dispatch({ type: "TOOL_CALL_ARG_DELTA", id: evt.id, delta: evt.delta });
      break;
    case "tool-call-end":
      dispatch({ type: "TOOL_CALL_END", id: evt.id, result: evt.result });
      break;
    case "done":
      dispatch({ type: "DONE", finishReason: evt.finishReason, hasOutput: evt.hasOutput });
      break;
    case "error":
      dispatch({ type: "ERROR", error: evt.error });
      break;
  }
}

// Tiny re-export to satisfy import-graph linters that want PROVIDERS visible
// from the demo; the picker uses its own list. Harmless if unused.
export { PROVIDERS };
