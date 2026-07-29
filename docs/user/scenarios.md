# Scenarios

Orchestrate multi-step API flows with **Scenarios** (Phase 1). Scenario definitions live under `.api-hero/scenarios/*.scenario.json` in your workspace.

## Open the view

Activity Bar → **API Hero** → **Scenarios** (or **API Hero: Focus Scenarios**).

## Create and edit

1. Click **New Scenario** (or **API Hero: New Scenario**).
2. Enter a name — a `.scenario.json` file is written under `.api-hero/scenarios/`.
3. The **Scenario Editor** opens so you can add request steps and conditions, then save.

Click a scenario in the tree (or **Open Scenario Editor**) to edit again. **Refresh** reloads the tree from disk.

## Run

Select a scenario and use **Run Scenario** (toolbar or context menu). When the run finishes, a **Scenario Run Report** shows step results.

Scenarios reuse the same request execution pipeline as Collections (environments, auth, variables). They do not replace Collection Runner / Execution Center for bulk collection runs.

## Related

- [Collections](./collections.md)
- [Collection Runner](./collection-runner.md)
- [Getting started](./getting-started.md)
