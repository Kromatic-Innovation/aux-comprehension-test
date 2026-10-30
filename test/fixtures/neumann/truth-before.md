# Ground truth: neumann tools/list (before copy)

Author-written intended meaning per tool, committed before any reader runs.

## run_simulation

Runs a Monte Carlo simulation of an uncertainty model (uncertain inputs, formulas and links) and returns the full distribution of outcomes with percentiles, not one guessed number. Use it when you need the range and likelihood of outcomes. One call is one run; it can spend a free run or credits.

- Misreading: It returns a run_id you must poll before the result is ready.

## oat_sensitivity

Ranks the model's uncertain inputs by how much each one moves a chosen target outcome (one-at-a-time sensitivity), returning tornado chart data. Use it to decide which input to de-risk or estimate more carefully first.

- Misreading: It ranks outcomes rather than inputs.

## scenario_analysis

Runs the model once and summarises one target outcome's worst, median and best values (or other percentiles). Use it for a short worst/typical/best story instead of the full distribution.

- Misreading: Worst means the most harmful outcome rather than the lowest value.

## validate_graph

Checks a model for structural mistakes such as loops, unconnected nodes, unknown distributions and broken formulas before you run it, returning the list of problems. It is free and does not run the simulation or price it.

- Misreading: It also estimates cost.

## estimate

Predicts the size, peak memory, tier and credit cost of a run without running it. Use it before a large or unfamiliar run to check what it will cost. It does not check the model for mistakes.

- Misreading: It estimates a probability or a forecast quantity.

## solve_distribution_parameters

Converts a rough min/max range at a stated confidence (or a most-likely value) into the exact distribution parameters a model input needs.

- Misreading: It runs a simulation.

## describe_distribution

Converts distribution parameters back into plain numbers: mean, median, mode, standard deviation, a central range and percentiles, and with a threshold the probability above or below it.

- Misreading: It is the same as the range-to-parameters converter.

## get_results

Fetches the saved status and summary of a run you already submitted, by its run_id. You never need it to wait for a normal run, which returns its full result directly.

- Misreading: You must call it after every simulation to get the result.

## feedback

Sends feedback, a feature request or a bug report to the Neumann team by email, copying the address you give. Check with the user first because it shares their address.

- Misreading: It files a public issue.

## buy_credits

Buys Neumann credits by charging the payment card already saved on the account. It spends real money, so the user must agree first. Without a saved card it charges nothing and returns a checkout link instead.

- Misreading: It deletes or changes account data.

## share_result

Creates or fetches a public share link for a persisted run saved through the stored-graph flow, renderable as HTML, JSON or SVG. It does not work for an ephemeral simulation result.

- Misreading: It works for any run_id.

## whoami

Reports who you are to Neumann and what you can still do: your account and credit balance, or the free anonymous runs left today (after this call) and when they reset. It is free.

- Misreading: The free-runs count still includes the current call.
