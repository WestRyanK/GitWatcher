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

This opens the viewer in a panel docked to the right side of that terminal window, below its tabs. When the tab
row is hidden (quake mode, focus mode, or full screen), the panel reaches the top of the window. The panel
follows the window when you move or resize it, hides when you minimize it, and closes when you close the window
or exit the shell. Drag the panel's left edge to change its width (double-click the edge to reset it). The panel's
minimize button shrinks it to a small button in the terminal's top-right corner. Click that button to open the panel
again. The viewer keeps running while it's minimized, so it reopens instantly. The width and the minimized state are
saved in `~/.git-graph/overlay.json`. To open the panel by typing `gg`, add an alias to your PowerShell profile:

```powershell
Set-Alias gg D:\source\GitHub\GitWatcher\GitGraph\Show-GitGraph.ps1
```

The panel is `GitGraph.Overlay`, a small WPF app. `Show-GitGraph.ps1` builds it on first use, and again whenever
its sources change. An open panel locks the program, so after an update the script starts the current version and
asks you to close every panel. The next run then rebuilds it. It needs the .NET 10 SDK, Node.js, and the WebView2 runtime, which comes with Windows 11. How
it works:

* It finds the terminal window through the console of the shell that started it: Windows Terminal owns that
  console's hidden window. `--terminal-window <hwnd>` picks a window directly.
* The panel is an owned window of the terminal window, so it stays just above the terminal (not above every
  window) and hides with it. A `SetWinEventHook` location-change hook keeps it docked. Nothing is injected into
  Windows Terminal, and Windows Terminal's own window isn't changed.
* It finds the top of the terminal panes through UI Automation (Windows Terminal's `TermControl` elements), instead
  of assuming a tab row, and checks again every half second in case the tab row was shown or hidden.
* It starts its own `server.js` on a free port for the shell's current folder, shows it with WebView2, and stops the
  server when it closes. The server also exits on its own if the panel's process goes away. The page settings are
  shared with the browser view.

## How it works

* `server.js` uses only Node's built-in modules (no `npm install`). It listens on `127.0.0.1` and runs only
  read-only git commands (`log`, `rev-list`, `for-each-ref`, `rev-parse`, `symbolic-ref`, `show`, `diff-tree`,
  `status`) with `GIT_OPTIONAL_LOCKS=0`. It never writes to the repository. The only request that writes anything
  is `PUT /api/settings` (see below); it rejects every other request that isn't `GET`.
* `GET /api/graph?scope=S&limit=N` returns commits from `git log --topo-order`, plus refs and HEAD. The page's
  **Commits from** selector sets the scope: `current` (`HEAD` only), `local` (`--branches` and `HEAD`), or `all`
  (`--all`, which also includes remote branches and tags).
* `GET /api/version` returns a fingerprint of the refs and HEAD. The page polls it every 3 seconds and reloads the
  graph when it changes. This covers new commits, branch moves, and checkouts.
* `GET /api/branches` returns local and remote branches from `git for-each-ref`, with each local branch's upstream,
  ahead/behind counts, and the worktree it's checked out in. The **Branches** pane lists them. Click one to jump to
  its tip commit.
* `GET /api/status` returns `git status --porcelain=v2 --branch` for the folder the server runs in: conflicts,
  staged, unstaged, and untracked files. The **Status** pane polls it with the graph. `GIT_OPTIONAL_LOCKS=0` stops
  `git status` from writing its refreshed index.
* The commit details are below the graph. Click a pane's title to collapse it toward its edge: **Commits** and
  **Commit details** collapse to their headers, and **Branches** or **Status** collapse the sidebar sideways to a
  narrow rail. Click a title in the rail to expand the sidebar again. Drag any divider to resize the panes (arrow
  keys work too when a divider has focus, and double-click resets it).
* The page remembers its state: **Commits from**, **Show**, **Live**, both filters, the selected commit, the
  **Remote** checkbox, pane sizes, and collapsed panes. `GET /api/settings` and `PUT /api/settings` read and save
  them in a per-user file, `~/.git-graph/settings.json` (set `GIT_GRAPH_SETTINGS` to use another path), so they
  survive restarts, port changes, and cleared browser data, and every worktree shares them. The server only
  accepts a save that comes from the viewer page itself: it must be JSON from the same origin, holding
  `git-graph.*` string values.
* `GET /api/commit/<hash>` returns the commit's message and its changed files. A merge's files are compared with
  its first parent.
* `public/app.js` lays the commits out in lanes and draws the graph as plain SVG.
