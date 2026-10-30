You are re-reading an MCP server's tools/list payload to check reader complaints. Each complaint was raised by exactly one reader. For each, re-read the copy it points at and decide whether the copy is genuinely ambiguous or misleading (a careful reader could reasonably take it the wrong way), or whether it is unambiguous and the reader simply misread it.

Reply with ONLY a JSON object, no prose and no markdown fences:
{"rereads": [{"id": "<complaint id>", "ambiguous": true|false, "why": "<one sentence>"}]}

PAYLOAD:
{{payload}}

COMPLAINTS:
{{complaints}}
