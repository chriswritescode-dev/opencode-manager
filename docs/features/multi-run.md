# Multi-run

Run one prompt across several models at once to compare their results.

## Launching a Multi-run

Open a repository and click **Multi-run** in the header, next to **New Session**. In the **Launch** tab:

1. Give the run group a **Group name**.
2. Enter the **Prompt** to send to every model.
3. Select up to **five models** from the checkbox list, grouped by provider.
4. Leave **Isolate runs** on to give each model its own workspace.
5. Optionally set **Start from** to a branch or ref. Empty starts from the current HEAD.

Click **Launch**. Each selected model gets its own session, and the same prompt is sent to all of them. Models are checked before any workspace is created, so a model that is not available fails its entry without creating a workspace while the other models still launch. Launching is parallel, and one model failing does not stop the others: the failed entry records its error while the rest keep running.

## Isolation

With **Isolate runs** on, each run is created in its own OpenCode workspace: a detached checkout of the repository at the chosen ref, with no branch created. These workspaces appear in the repository's **Workspaces** tab, and the session for an isolated run opens with that tab selected. With isolation off, every run shares the repository directory.

## Runs

The **Runs** tab lists each group and its entries. Every entry shows the model, its status, and for a started run the live session status indicator. From here you can:

- **Open** a run to view its session and compare the result.
- **Discard** a run after confirmation. Discarding an isolated run also removes its workspace directory from the Workspaces tab; if that workspace was already removed, for example from the Workspaces tab, discarding still succeeds. A non-isolated run keeps its session in the repository.

Discarding is irreversible and cannot be repeated on an already discarded run. Deleting a repository removes its multi-run history.
