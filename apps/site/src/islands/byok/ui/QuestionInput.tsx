/**
 * QuestionInput — textarea + suggested-question chips + Submit/Stop button.
 *
 * Submit on Cmd/Ctrl+Enter (textarea convention). Stop button shown
 * during streaming. Question chips are pre-written prompts the user
 * can click to populate the textarea — gives readers an immediate "try
 * this" affordance without requiring them to know what to ask.
 */

import type { JSX } from "preact";

interface Props {
  value: string;
  onChange: (q: string) => void;
  onSubmit: () => void;
  onAbort: () => void;
  /** True while the demo is submitting or streaming. */
  inFlight: boolean;
  canSubmit: boolean;
  chips: string[];
  onPickChip: (q: string) => void;
}

export default function QuestionInput({
  value,
  onChange,
  onSubmit,
  onAbort,
  inFlight,
  canSubmit,
  chips,
  onPickChip,
}: Props): JSX.Element {
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (canSubmit && !inFlight) onSubmit();
    }
  }

  return (
    <div class="byok-question">
      <label class="byok-label" for="byok-question-input">
        Question
      </label>
      <textarea
        id="byok-question-input"
        class="byok-input byok-input-textarea"
        rows={4}
        value={value}
        placeholder="Ask anything about the Falsafa corpus."
        aria-describedby="byok-question-help"
        disabled={inFlight}
        onInput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)}
        onKeyDown={handleKeyDown}
      />
      <p id="byok-question-help" class="byok-help">
        Cmd/Ctrl + Enter to submit.
      </p>

      {chips.length > 0 && !inFlight && (
        <div class="byok-chips">
          <p class="byok-chips-label">Try one:</p>
          <ul class="byok-chips-list">
            {chips.map((chip, i) => (
              <li>
                <button
                  type="button"
                  class="byok-chip"
                  onClick={() => onPickChip(chip)}
                >
                  {chip}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div class="byok-question-actions">
        {inFlight ? (
          <button type="button" class="byok-button byok-button-stop" onClick={onAbort}>
            Stop generating
          </button>
        ) : (
          <button
            type="button"
            class="byok-button byok-button-primary"
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            Submit
          </button>
        )}
      </div>
    </div>
  );
}
