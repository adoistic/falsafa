# Serial run, not blind — kept for audit only

The orchestrator that produced this run discovered mid-task that a
general-purpose sub-agent cannot dispatch further sub-agents (the
Agent tool isn't surfaced in nested sessions). Rather than abort, it
answered all 12 questions itself, in series, from a single session.

That violates the per-question independence property the eval needs.
The MCP `read_chapter` patch and the anti-cheat patch were exercised
end-to-end — every citation used a `p-xxxxxx` hash (not the verse-
marker-as-id pattern), and the agent never touched ground-truth files
— but the 12/12 mechanical pass-rate cannot be cited as a paper-grade
blind result.

The blind redo lives at `apps/mcp/eval/runs/1k-final-patched-sonnet/`,
dispatched from the host (Claude Code main session) where the Agent
tool is available, one fresh sub-agent per question.

Files preserved here for audit. Not used in any published number.
