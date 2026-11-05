# Maintaining the browser fork

This fork maintains only the WASM browser editor, reusing upstream’s document, editing, rendering and export engines. Inherited desktop source is retained to ease synchronization; desktop compatibility, tests, installers and releases are not maintained here. The upstream project is [deepfounder-ai/desigma](https://github.com/deepfounder-ai/desigma); this fork is [jixoai/desigma](https://github.com/jixoai/desigma).

## Branches and remotes

| Name | Purpose |
| --- | --- |
| `origin` | `jixoai/desigma`; the default push destination |
| `upstream` | Original project; fetch only (push URL `DISABLED`) |
| `main` | Unmodified upstream history mirror, advanced only by fast-forward; not a supported product branch |
| `browser-wasm` | Default branch and long-lived browser implementation |
| `sync/upstream-<commit>` | Temporary merge and validation branch for one upstream revision |

Keep feature work on branches based on `browser-wasm`. Never force-push, rebase or squash the published maintenance history. **Merge upstream sync PRs using Create a merge commit**: a squash loses the ancestry Git needs for the next update. Ordinary independent feature PRs may be squashed.

The supported setup is in [browser.md](browser.md), and distribution is described in [releasing.md](releasing.md). Inherited desktop instructions are upstream references only. Desktop CI and Release are disabled at the GitHub repository level as well as removed from the maintenance branch; this also prevents the unmodified `main` mirror from starting desktop builds. This repository does not publish a site or deploy the optional signaling service automatically.

For a fresh clone:

```sh
git clone https://github.com/jixoai/desigma.git
cd desigma
git switch browser-wasm
git remote add upstream https://github.com/deepfounder-ai/desigma.git
git remote set-url --push upstream DISABLED
git config remote.pushDefault origin
git config pull.ff only
```

[.github/upstream.json](../.github/upstream.json) records the source repository, branch and most recently integrated upstream commit. Update its revision only after that commit is actually in the maintenance history. The helper verifies this ancestry.

## Scheduled updates

[Sync upstream](../.github/workflows/sync-upstream.yml) runs Mondays at 02:17 UTC (10:17 Asia/Shanghai), or from **Actions → Sync upstream → Run workflow**. It only runs in `jixoai/desigma` and requires `browser-wasm` to be the default branch for the schedule to activate.

1. Fetch both repositories and fast-forward the fork's `main`. Refuse if the mirror contains divergent local commits.
2. Leave any open upstream sync PR alone; finish that review before starting another.
3. Merge upstream into a new `sync/upstream-*` branch in an isolated worktree. Record the upstream commit only after a successful merge.
4. Run only WASM/browser CI against the exact sync commit. It checks the WASM target, JS/storage/transport tests, Git sync tests, the optimized build and bundle budget; it derives Rust and wasm-bindgen versions from repository lock files. The maintenance scope check rejects reintroduced desktop CI or release workflows.
5. Open a **draft PR** targeting `browser-wasm`, including the validation outcome and workflow run. Failures stay visible. Nothing merges automatically.

Bot pushes made with `GITHUB_TOKEN` do not start a separate push/PR workflow run. The sync workflow therefore invokes the reusable browser validation workflow itself before creating the draft. Its run link is the validation evidence; a newly created draft may not display independent PR checks. After a human pushes fixes, ordinary PR CI also runs. If you configure branch protection later, account for that GitHub token behavior rather than assuming a bot-created PR starts its own checks.

On a merge conflict, the maintenance branch is untouched, the workflow fails with a file list, and a conflict patch is uploaded for inspection. Reproduce and resolve it locally using the steps below. If PR creation fails (for example, Actions lacks PR write permission), the sync branch remains on the fork and can be used to open a PR manually. An already-published sync branch is never overwritten by a retry.

## Local synchronization

Start with a clean checkout. The helper never stashes or discards work, modifies the current branch, pushes to upstream, or force-pushes.

```sh
# Read the state, fetching current branch tips first.
python3 scripts/sync-upstream.py status --fetch

# Optional: update only the fork's unmodified main mirror.
python3 scripts/sync-upstream.py mirror-main

# Integrate in a new worktree, leaving this checkout available.
python3 scripts/sync-upstream.py prepare --worktree ../desigma-upstream
```

If already current, `prepare` creates nothing. Otherwise it prints the worktree, branch, base commit and full upstream revision. A clean merge receives an explicit merge commit and a provenance commit; there is no automatic push.

```sh
cd ../desigma-upstream

# If there are conflicts: resolve the listed files, then:
git add <resolved-files>
git commit
python3 scripts/sync-upstream.py record --revision <full-upstream-commit-printed-by-prepare>

# Node 22+, the pinned Rust toolchain + WASM target,
# matching wasm-bindgen CLI and Binaryen must be installed (see browser.md).
python3 scripts/sync-upstream.py check

git push --set-upstream origin HEAD
# Open a draft PR to jixoai/desigma:browser-wasm, with validation results.
```

Use `git merge --abort` **inside the new worktree** to abandon a conflicted merge. To resume an already-pushed sync branch, fetch and create a worktree from that branch instead of recreating it. Re-run validation after conflict resolution. Before merging the PR, also verify in a real browser:

- WebGPU and WebGL fallback; original editor UI, Undo/Redo and invalid-batch rollback.
- A cold library file opens, edits persist, refresh restores it, and partial snapshots never commit.
- Worker imports/exports and cancellation, plugin insertion, native WebMCP registration and the JS fallback.
- Invitation and reply links; automatic signaling with BroadcastChannel disabled for the guest.
- A focused 5000-layer benchmark. Keep every sample's focus/visibility evidence and retain older measurements. Do not replace previous evidence with unmeasured claims.

After merging, update the maintenance checkout with `git pull --ff-only`, then remove the temporary worktree and branch when no longer needed. Keep the recorded upstream revision in the merge history. `main` needs no browser changes.

## Boundaries that keep merges manageable

| Area | Keep shared / browser-specific behavior |
| --- | --- |
| `desigma-doc`, `desigma-engine`, layout, import/export | One shared implementation; generic fixes belong here and must preserve browser behavior |
| `desigma-platform` | Filesystem, absolute paths, clocks and task spawning; WASM uses browser adapters; inherited native paths stay isolated |
| `desigma-app/src/lib.rs` | Shared original app modules and WASM entry points; the inherited native entry point is outside maintenance scope |
| `desigma-app/src/web/`, `web/` | Browser bootstrap, storage, Worker, plugins, WebMCP, WebRTC and browser UI |
| `desigma-mcp/src/catalog.rs` | Common tool schemas; native server and browser catalog both consume it |
| `desigma-app/src/web_tools.rs` | Browser additions routed through shared editor transactions and Undo |
| `Cargo.toml` and per-crate manifests | Keep native libraries outside the maintained WASM dependency graph |

Upstream changes to the old `desigma-app/src/main.rs` must be reconciled with the extracted `lib.rs`; do not restore two copies of the editor. Prefer `cfg` module selection and small platform calls to duplicating engine logic. New common code must use `desigma_platform::fs`, `PathExt` and `web_time` where browser support is required. Native-only process, thread and socket dependencies need target gating.

Keep `Cargo.lock` and both npm lock files committed. Resolve a dependency merge deliberately and validate the WASM target; do not delete lock files to silence conflicts. When upstream changes the compiler, update `rust-toolchain.toml` deliberately. Browser CI reads the toolchain file and the wasm-bindgen version from `Cargo.lock`, avoiding an independent version pin.

Resolve modify/delete conflicts on `.github/workflows/ci.yml` and `release.yml` by keeping the fork’s deletion. Do not re-enable these desktop workflows when mirroring upstream. Review any newly introduced workflow for the same WASM-only scope.

Treat changes to shared MCP schemas, document serialization, export signatures, collaboration permissions and storage formats as compatibility changes. Update the adapter and behavior tests in the same PR. Storage migrations must preserve pending bytes and existing documents. Keep generated `dist/`, native build outputs and `node_modules` out of Git; publish CI artifacts with their build metadata instead.
