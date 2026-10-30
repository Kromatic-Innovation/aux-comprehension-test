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

## Scope notes

- Provider API keys are read from environment variables only and sent in
  request headers. They are never written to the run directory or logged.
- Reader outputs quote the `tools/list` payload under test verbatim. Treat a
  run directory as you would the payload itself.
- The only runtime dependency is `panelist`.
