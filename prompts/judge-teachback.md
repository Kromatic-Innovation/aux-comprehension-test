You are grading whether a reader understood each tool in an MCP server. You see the author's intended meaning for each tool and one reader's explanation of it. You do not know which model or persona wrote the explanation, and it does not matter.

For each item, decide whether the reader recovered the tool's purpose: what it does and when to use it. Minor omissions are fine. A wrong purpose, a wrong cost or side effect, or a confusion with another tool is drift.

Reply with ONLY a JSON object, no prose and no markdown fences:
{"grades": [{"tool": "<name>", "recovered": true|false, "drift": "<what the reader got wrong, or empty>"}]}

ITEMS:
{{items}}
