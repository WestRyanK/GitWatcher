# Git Graph

A small, read-only web viewer for this repository's commit graph. It shows branches, remote branches, tags, merges,
and HEAD, and updates while you work. Click a commit to see its full message, author, date, and changed files.

## Running it

In Claude Code, type `/git-graph` (or ask Claude to open the git graph). In the desktop app it opens the viewer in
the Browser pane. In the terminal it starts the server and gives you the URL. The skill is in
[`.claude/skills/git-graph`](../.claude/skills/git-graph/SKILL.md).

You can also start **git-graph** from the desktop app's Browser pane **Dev servers** menu. The entry is in
[`.claude/launch.json`](../.claude/launch.json).

From a terminal:

```powershell
node GitGraph/server.js
```

Then open <http://localhost:4173>. Set `PORT` to use a different port. Pass a path as the first argument to view a
different repository.

## Docked in Windows Terminal

From PowerShell in Windows Terminal (or a classic console window), run:

```powershell
.\GitGraph\Show-GitGraph.ps1
```

In Windows Terminal, this splits the current tab: a new pane on the right reserves room for the viewer, and the
panel sits exactly over that pane. Your shell's pane gets narrower, so its text wraps before the panel instead of
going under it. The panel follows the window when you move or resize it, hides when you minimize the window or
switch to another tab, and closes (with its pane) when you close the window or exit the shell. It works with the tab
row hidden too (quake mode, focus mode, or full screen).

* **Width:** resize the pane with Windows Terminal's pane resizing (Alt+Shift+arrow keys by default). The panel
  follows it, and the next pane opens at the same width.
* **Minimize:** the panel's minimize button closes the pane, so your shell gets its full width back, and leaves a
  small button in the terminal's top-right corner. Click it to split the pane again and reopen the panel. Closing the
  pane yourself does the same as minimizing. The viewer keeps running while it's minimized, so it reopens instantly.
* The width and the minimized state are saved in `~/.git-graph/overlay.json`.

In a classic console window, which has no panes, the panel covers the right side of the window instead, below any
title bar. Drag its left edge to change the width (double-click the edge to reset it).

To open the panel by typing `gg`, add an alias to your PowerShell profile:

```powershell
Set-Alias gg D:\source\GitHub\GitWatcher\GitGraph\Show-GitGraph.ps1
```

The panel is `GitGraph.Overlay`, a small WPF app. `Show-GitGraph.ps1` builds it on first use, and again whenever
its sources change. An open panel locks the program, so after an update the script starts the current version and
asks you to close every panel. The next run then rebuilds it. It needs the .NET 10 SDK, Node.js, and the WebView2
runtime, which comes with Windows 11. How it works:

* It finds the terminal window through the console of the shell that started it: Windows Terminal owns that
  console's hidden window. `--terminal-window <hwnd>` picks a window directly.
* It reserves room with `wt --window 0 split-pane --vertical`, which splits the active tab of the most recently used
  Windows Terminal window, the one you just typed in. Before splitting again on restore, it brings that window to the
  front. The new pane gets a unique title and runs a small Windows PowerShell loop that waits on a named event. The
  panel signals the event to close the pane, and the loop also ends if the panel's process is gone. If the pane
  doesn't appear in the terminal window within 10 seconds, the panel closes it and covers the window instead.
* The panel is an owned window of the terminal window, so it stays just above the terminal (not above every
  window) and hides with it. A `SetWinEventHook` location-change hook keeps it in place while the window moves.
  Nothing is injected into Windows Terminal.
* Every half second it asks UI Automation where Windows Terminal's panes (`TermControl` elements) are. That gives the
  placeholder pane's exact bounds (and its width for next time), shows whether its tab is active (only the active
  tab's panes are reported), and gives the top of the panes for the minimized button and the classic overlay.
* It starts its own `server.js` on a free port for the shell's current folder, shows it with WebView2, and stops the
  server when it closes. The server also exits on its own if the panel's process goes away. The page settings are
  shared with the browser view.

## How it works

* `server.js` uses only Node's built-in modules (no `npm install`). It listens on `127.0.0.1` and runs only
  read-only git commands (`log`, `rev-list`, `for-each-ref`, `rev-parse`, `symbolic-ref`, `show`, `diff-tree`,
  `status`, and `ls-remote --get-url`, which only reads the configured URL) with `GIT_OPTIONAL_LOCKS=0`. It never writes to the repository. The only request that writes anything
  is `PUT /api/settings` (see below); it rejects every other request that isn't `GET`.
* `GET /api/graph?scope=S&limit=N` returns commits from `git log --topo-order`, plus refs and HEAD. The page's
  **Commits from** selector sets the scope: `current` (`HEAD` only), `local` (`--branches` and `HEAD`), or `all`
  (`--all`, which also includes remote branches and tags).
* `GET /api/version` returns a fingerprint of the refs and HEAD. The page polls it every 3 seconds and reloads the
  graph when it changes. This covers new commits, branch moves, and checkouts.
* `GET /api/branches` returns local and remote branches from `git for-each-ref`, with each local branch's upstream,
  ahead/behind counts, and the worktree it's checked out in, plus every tag, by name. The **Branches** pane
  shows them as a tree: a **Branches** node for the local branches, and **Remote branches** and **Tags** nodes,
  which start closed. Inside them, branches are in folders by name (`claude/...` under **claude**). Tags are grouped
  the same way, by slashes, or by hyphens (`MyApp-v2026.10.02` under **MyApp**), or not at all: choose with
  **Group tags by** in the **Options** menu or by right-clicking the **Tags** node. Nodes and folders open and close
  with a click. Click a branch or tag to jump to its commit.
* `GET /api/status` returns `git status --porcelain=v2 --branch` for the folder the server runs in: conflicts,
  staged, unstaged, and untracked files. The **Status** pane polls it with the graph. `GIT_OPTIONAL_LOCKS=0` stops
  `git status` from writing its refreshed index.
* The commit filter, **Commits from**, **Show**, and **Live** are in the **Options** menu (the sliders icon at the
  top right), which keeps the toolbar to one line.
* The commit details are below the graph. Double-click a commit to open them if they're collapsed. Click a pane's
  title to collapse it to its title row or open it again.
* **Branches** and **Status** open and close separately from the buttons on the sidebar's rail, which is always
  visible. An open pane's button is highlighted. Clicking **Status** opens only Status, and clicking **Branches** as
  well shows both, stacked. With both closed, only the rail is left. Clicking an open pane's title closes it too.
* Drag any divider to resize the panes (arrow keys work too when a divider has focus, and double-click resets it).
* Right-click a commit to copy its hash, short hash, subject, or full message, show its details, or open it in Azure
  DevOps (or GitHub; the link comes from the `origin` remote). Right-click a branch or tag to copy its name, go to
  its commit, or copy a `git checkout` command to run yourself. The menu never changes the repository. In the
  Windows Terminal overlay, web links open in the default browser.
* The **Author**, **Date**, and **Commit** labels in the Commits title row line up with those columns. Those columns
  stay against the right edge, and the subjects take the rest of the width, so opening the sidebar or resizing the
  window only narrows the subjects. Drag the edge before a label to resize the column to its left, like a table, and
  the columns after it move along, with the **Commit** column taking up the difference. For example, dragging the
  edge before **Author** to the right gives the subjects more room. Double-click an edge to reset the column.
* Show or hide the **Author**, **Date**, and **Commit** columns with the **Columns** checkboxes in the **Options**
  menu, or by right-clicking the Commits title row. A hidden column's space goes to the subjects, and it comes back
  at the width it had. Dragging a column down to nothing also hides it. Narrow windows start without the author and
  date.
* The page remembers its state: **Commits from**, **Show**, **Live**, both filters, the selected commit, the open
  nodes and folders in the branch tree, pane sizes, and collapsed panes. `GET /api/settings` and `PUT /api/settings`
  read and save them in a per-user file, `~/.git-graph/settings.json` (set `GIT_GRAPH_SETTINGS` to use another path), so
  they survive restarts, port changes, and cleared browser data, and every worktree shares them. The server only accepts
  a save that comes from the viewer page itself: it must be JSON from the same origin, holding `git-graph.*` string
  values.
* `GET /api/commit/<hash>` returns the commit's message and its changed files. A merge's files are compared with
  its first parent.
* `public/app.js` lays the commits out in lanes and draws the graph as plain SVG.
