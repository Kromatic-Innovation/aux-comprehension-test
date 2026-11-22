You are grading whether a reader understood each tool in an MCP server. For each tool you see the author's intended meaning, the tool's own text from the payload the reader was shown, and one reader's explanation of it. You also see the server instructions the reader was shown. You do not know which model or persona wrote the explanation, and it does not matter.

For each item, decide whether the reader recovered the tool's purpose: what it does and when to use it. Minor omissions are fine. A wrong purpose, a wrong cost or side effect, or a confusion with another tool is drift.

The intended meaning is a summary and may leave details out. A detail the reader states that is present in the payload (the tool's own text or the server instructions) is never drift, even when the intended meaning does not mention it. Only call a detail invented if neither the intended meaning nor the payload supports it.

Reply with ONLY a JSON object, no prose and no markdown fences:
{"grades": [{"tool": "<name>", "recovered": true|false, "drift": "<what the reader got wrong, or empty>"}]}

SERVER INSTRUCTIONS:
{{instructions}}

ITEMS:
{{items}}
