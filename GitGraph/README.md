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
