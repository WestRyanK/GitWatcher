---
name: git-watcher
description: >
  Opens Git Watcher, the live git graph viewer, for the current repository: the commit graph, branches, and working
  tree status, refreshing as the repo changes. Use when asked to open, show, or start Git Watcher, the git graph,
  commit graph, branch graph, or git graph viewer.
---

## Role

You open Git Watcher, a read-only git graph viewer, for the user's current repository. Don't change the viewer's
code or the repository, and don't add files to the repository. Only start the viewer and show it.

Git Watcher's server is installed at:

```
{{ServerPath}}
```

If that file doesn't exist, tell the user that Git Watcher has moved or been removed, and that running `Install.ps1`
from their Git Watcher clone installs this skill again with the right path. Then stop.

## Find or start the viewer

1. Find the repository root: the session's root folder, or `git rev-parse --show-toplevel` from it. In a worktree,
   use the worktree's root.
2. If the session's `.claude/launch.json` has a `git-watcher` entry (as Git Watcher's own repository does) and the
   Browser pane's preview tools are available, call `preview_start` with `name: "git-watcher"`, then skip to
   **Show it**.
3. Look for a viewer that's already running for this repository. For each port from 4173 to 4182, request
   `http://localhost:<port>/api/graph?limit=1`. A response whose `repoPath` is this repository's root (compare them
   ignoring case and the direction of slashes) is a running viewer for it: use that port. Any other response, or a refused connection, means the port isn't this
   repository's viewer.
4. If none is running, start one in the background on the first port from 4173 to 4182 that doesn't answer at all:
   run `node "{{ServerPath}}" "<repository root>"` with the `PORT` environment variable set to that port, in the
   background (the Bash tool's `run_in_background`, or the PowerShell tool's). Wait until
   `http://localhost:<port>/api/version` answers (a few seconds at most). If the server prints an error instead,
   show it to the user and stop.

## Show it

- **Claude Code desktop app** (the Browser pane's preview tools are available): if you didn't use `preview_start`
  by name, call `preview_start` with `url: "http://localhost:<port>"`. Tell the user in one line that the viewer is
  open in the Browser pane.
- **Elsewhere** (terminal CLI): give the user the URL, `http://localhost:<port>`, to open in their browser.

If you started the server, mention that it keeps running in the background until they stop it or end the session.

## Notes

- The viewer needs Node.js (any current version). It has no npm dependencies, so there's nothing to install.
- It shows the repository it's started for. In a worktree, that worktree's HEAD and working tree status. The graph
  itself includes every branch in the repository.
- To dock the viewer beside Windows Terminal instead, the user can run `Start-GitWatcher` in PowerShell.
