# neumann fixture

The `tools/list` payload of the neumann Monte Carlo simulation MCP server
(<https://kromatic.com/mcp/neumann>), captured at two server versions:

| File | Server version | What it is |
|---|---|---|
| `tools-before.json` | 0.2.5 | The copy that introduced a billing block on every tool result. The comprehension test run against it found the free-runs count ambiguous ("counting this call"). |
| `tools-after.json` | 0.2.10 | The revised copy: renamed tools, rewritten descriptions, and the free-runs count reworded to "after this call". |

Both payloads were produced by the server's own `tools/list` handler with the
public base URL configured, then pretty-printed. They are otherwise verbatim
with two exceptions in the 0.2.5 copy, neither part of what the test
examines:

- 21 references to the server's issue tracker (for example "(tracker#278)"):
  17 parenthetical references were removed and 4 inline ones were replaced
  with `[ref]` (262 characters).
- 5 notes in the sensitivity-analysis output schema naming the internal system
  that schema was copied from were removed (148 characters).

The 0.2.10 copy is unmodified.

`truth-*.md` and `requests-*.json` are the ground truth and routing requests
for each version. The tool names changed between versions, so each version has
its own pair; the request texts are identical.

## What the fixture test does and does not show

`test/neumann-fixture.test.mjs` replays scripted reader responses. They are a
**reconstruction** of the findings the manual comprehension test recorded
against this copy, not verbatim model output. Each scripted reader reacts only
to text it finds in the payload it is shown, so the before/after difference
comes from the copy, not from which file the test loaded. The test proves the
grader turns those findings into the right cut-list and verdict; it says
nothing about how a live model would read the copy. That is what the manual
live eval (`eval/`) is for.

In the 0.2.5 copy two readers flag the free-runs count, but none of them
misroutes or misexplains the account tool, so the grader reports it as an
informational confusion-only row; it does not hold the verdict off `pass`.
The 0.2.10 copy no longer trips it at all.

The repeated billing sub-schema is flagged as informational in **both**
versions. The revision deliberately kept schema size, under the rule that
length alone is not a defect, so an honest measurement still flags it. It
never affects the verdict.
