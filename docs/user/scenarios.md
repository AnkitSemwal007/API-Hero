# Scenarios

Orchestrate multi-step API workflows with **Scenarios**. Scenario definitions live under `.api-hero/scenarios/*.scenario.json` in your workspace.

## How this fits API Hero

| Concept | Answers |
| --- | --- |
| **Collections** | What APIs do I have? |
| **Requests** | How do I call this API? |
| **Scenarios** | How do I automate an API workflow? |

**Collection Runner** executes many requests. A **Scenario** automates one API workflow with branches and shared data.

## Open the view

Activity Bar → **API Hero** → **Scenarios** (or **API Hero: Focus Scenarios**).

## Create and edit

1. Click **New Scenario** (or **API Hero: New Scenario**).
2. Pick a **starter template** (login + token reuse, health-check branch, CRUD, …) or **Start Blank**.
3. Enter a name — a `.scenario.json` file is written under `.api-hero/scenarios/`.
4. The **Scenario Editor** opens with a left **palette** (requests, logic, variables, utilities), canvas, and guided properties.

Use the palette or **Ctrl/Cmd+K** to add steps. Edge **+** inserts a step on a connection. Template steps start unbound — use **Choose Request…** to link each request to your Collection (or ensure `requestRef` matches a Collection request name so it can resolve at run time). Authentication is reused from Collection auth profiles — open **Manage Authentication…** from the palette or inspector.

Click a scenario in the tree (or **Open Scenario Editor**) to edit again. **Refresh** reloads the tree from disk. The tree shows each scenario’s description and last-run status (stored in workspace state, not in the `.scenario.json` file).

## Run

Select a scenario and use **Run Scenario** (toolbar, editor **Run**, or context menu). If the scenario defines variables, you can run with defaults or override inputs for this run only. Live step status highlights in the open editor. When the run finishes, a **Scenario Report** shows step results.

Scenarios reuse the same request execution pipeline as Collections (environments, auth, variables). They do not replace Collection Runner / Execution Center for bulk collection runs.

## Related

- [Collections](./collections.md)
- [Collection Runner](./collection-runner.md)
- [Getting started](./getting-started.md)
