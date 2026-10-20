---
name: git-watcher
description: >
  Opens Git Watcher, the live git graph viewer, for this repository: the commit graph, branches, and working
  tree status, refreshing as the repo changes. Use when asked to open, show, or start Git Watcher, the git graph,
  commit graph, branch graph, or git graph viewer.
---

## Role

You open Git Watcher, the read-only git graph viewer in [`GitWatcher`](../../../README.md), for the user. Don't
change the viewer's code or the repository. Only start the viewer and show it.

## In the Claude Code desktop app

If the Browser pane's preview tools are available (`preview_start`):

1. Call `preview_start` with `name: "git-watcher"`. This is the entry in `.claude/launch.json`. It reuses the server
   if one is already running, and opens the viewer in the Browser pane.
2. If the result says the configuration wasn't found, the session's folder doesn't have the entry (for example, a
   worktree made before the viewer was merged). Add this entry to the `configurations` array of
   `.claude/launch.json` at the session's root folder, creating the file if needed, then call `preview_start`
   again:

   ```json
   {
     "name": "git-watcher",
     "program": "GitWatcher/server.js",
     "port": 4173,
     "autoPort": true
   }
   ```

3. Tell the user in one line that the viewer is open in the Browser pane. They can also start or stop it from the
   pane's **Dev servers** menu.

## Elsewhere (terminal CLI, no Browser pane)

1. Check whether the viewer is already running: request `http://localhost:4173/api/version`. If it answers, give
   the user that URL and stop.
2. Otherwise start it in the background from the repository root (or worktree root) with
   `node GitWatcher/server.js`. The server reads `PORT` (default 4173) and shows the repository it's started
   in.
3. Give the user the URL, `http://localhost:4173`, to open in their browser, and mention that the server keeps
   running in the background until they stop it.

## Notes

- The viewer needs Node.js (any current version). It has no npm dependencies, so there's nothing to install.
- It shows the repository of the folder it's started in. In a worktree, that worktree's HEAD and working tree
  status. The graph itself includes every branch in the repository.
