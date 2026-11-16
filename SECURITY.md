# Security Policy

## Supported versions

aux-comprehension-test is pre-1.0. Only the latest `0.x` release is supported
with security fixes.

## Reporting a vulnerability

Please report suspected vulnerabilities privately; do **not** open a public
issue. Email **security@kromatic.com** with a description, steps to reproduce,
and the affected version.

We aim to acknowledge reports within 3 business days and to give an initial
assessment within 10 business days.

## Maintenance

Outside security reports, maintenance is **best effort, with no SLA**: we aim
to reply to general issues within about two weeks, with no guaranteed
response time. The code is Apache-2.0, so you are free to fork it, patch it
and publish your fork under its own name.

## Network and data sent

A live run contacts only these hosts, and only for providers you name in
`--models` or `--judge` and hold a key for:

- `api.anthropic.com`
- `api.openai.com`
- `api.x.ai`
- `generativelanguage.googleapis.com`

Nothing else is called: no telemetry, no update check, no remote price lookup.

The **full `tools/list` payload** and the **reader prompts** (which contain the
payload and the text of every routing request) are sent to each reader's
provider. With `--judge`, the judge's provider also receives your ground-truth
file, the readers' teach-backs and the payload. Do not run a payload or ground
truth you may not share with those providers.

`--estimate-only` and `npm test` contact no provider. `--estimate-only` builds
and prices the prompts and stops before any model call; the test suite
replaces `fetch` with one that fails any test that tries to use the network.

## Scope notes

- Provider API keys are read from environment variables only and sent in
  request headers. They are never written to the run directory or logged.
- Reader outputs quote the `tools/list` payload under test verbatim. Treat a
  run directory as you would the payload itself.
- The only runtime dependency is `panelist`.
