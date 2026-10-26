# The file this shell writes its current folder to for a following overlay (Start-GitWatcher -Follow), and whether
# the hook that writes it is installed.
$script:followFile = $null
$script:followHookInstalled = $false
$script:previousLocationChangedAction = $null

# Runs after every change of folder in this shell. The overlay deletes the file when it closes, which stops the writes.
function Update-GitWatcherFollowFile {
    param($LocationChangedEventArgs)

    $file = $script:followFile
    if (-not $file -or -not (Test-Path -LiteralPath $file)) {
        return
    }
    $location = $LocationChangedEventArgs.NewPath
    $folder = if ($location.Provider.Name -eq 'FileSystem') { $location.ProviderPath } else { $location.Path }
    try {
        [System.IO.File]::WriteAllText($file, $folder)
    } catch {
        # The server is reading it. The next change of folder writes it again.
    }
}

function Start-GitWatcher {
    <#
    .SYNOPSIS
        Docks Git Watcher, the live git graph viewer, to the right side of the current terminal window, or opens it
        in a window of its own.

    .DESCRIPTION
        Starts GitWatcher.Overlay, a small WPF app that shows Git Watcher for a repository in a panel docked to the
        right side of the terminal window you run this from. In Windows Terminal it splits the current tab and covers
        the new pane, so your shell's text wraps before the panel. The panel follows the window when you move or
        resize it, hides when you minimize it or switch tabs, and closes when you close the window or this shell.
        With -Window, it opens in a window of its own instead, which stays open until you close it.

        The first run builds the app (it needs the .NET 10 SDK), and so does any run after its sources change. The
        viewer also needs Node.js on PATH and the WebView2 runtime, which comes with Windows 11.

    .PARAMETER Path
        The folder whose repository to show. Defaults to the current directory.

    .PARAMETER Follow
        Keeps showing the repository of this shell's current folder: after a cd into another repository, the panel
        shows that one, and outside any repository it says so.

    .PARAMETER Window
        Opens Git Watcher in a window of its own, with a title bar and a taskbar button, instead of docking it to the
        terminal. The window stays open after you close the terminal. Running it again for the same folder brings
        that folder's window to the front instead of opening another, unless you also pass -Follow. With -Follow, the
        window follows this shell until the shell exits, and then keeps showing the last repository.

    .EXAMPLE
        Start-GitWatcher

        Shows the current directory's repository next to this terminal.

    .EXAMPLE
        Start-GitWatcher -Follow

        Shows the current directory's repository, and changes to another one when you cd into it.

    .EXAMPLE
        Start-GitWatcher -Window

        Shows the current directory's repository in a window of its own.

    .EXAMPLE
        Set-Alias gw Start-GitWatcher

        Add this to your PowerShell profile to open the overlay by typing gw.
    #>
    [CmdletBinding()]
    param(
        [string]$Path = (Get-Location).Path,
        [switch]$Follow,
        [switch]$Window
    )

    $ErrorActionPreference = 'Stop'

    $repositoryPath = (Resolve-Path -LiteralPath $Path).ProviderPath
    git -C $repositoryPath rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Not a git repository: $repositoryPath"
        return
    }

    $projectDirectory = Join-Path $PSScriptRoot 'GitWatcher.Overlay'
    $project = Join-Path $projectDirectory 'GitWatcher.Overlay.csproj'
    $executable = Join-Path $projectDirectory 'bin\Release\net10.0-windows\GitWatcher.Overlay.exe'

    # Build when the app is missing or any of its sources is newer than it.
    $sources = Get-ChildItem $projectDirectory -File -Recurse -Include *.cs, *.xaml, *.csproj, *.manifest |
        Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' }
    $needsBuild = -not (Test-Path $executable)
    if (-not $needsBuild) {
        $builtAt = (Get-Item $executable).LastWriteTime
        $needsBuild = [bool]($sources | Where-Object { $_.LastWriteTime -gt $builtAt })
    }

    # An open overlay locks its program file, so it can't be rebuilt until every overlay is closed.
    $running = Get-Process -Name GitWatcher.Overlay -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq (Resolve-Path -LiteralPath $executable -ErrorAction SilentlyContinue).ProviderPath }
    if ($needsBuild -and $running) {
        Write-Warning 'The Git Watcher overlay has changed, but an open overlay is using it. Close all overlays to update it. Starting the current version.'
        $needsBuild = $false
    }

    if ($needsBuild) {
        Write-Host 'Building the Git Watcher overlay...'
        dotnet build $project --configuration Release --nologo --verbosity quiet
        if ($LASTEXITCODE -ne 0) {
            throw 'The Git Watcher overlay failed to build.'
        }
    }

    # A trailing backslash would escape the closing quote, as in "C:\".
    if ($repositoryPath.EndsWith('\')) {
        $repositoryPath += '.'
    }

    # The app finds this terminal's window through the console of its parent process, which is this shell. Passing
    # the shell's process ID closes the overlay when this shell (or its tab) closes. A standalone window needs neither.
    $arguments = if ($Window) {
        "--repo `"$repositoryPath`" --window"
    } else {
        "--repo `"$repositoryPath`" --shell-process $PID"
    }

    if ($Follow) {
        # One file per shell, named for it, which the hook rewrites as this shell changes folders.
        $script:followFile = Join-Path ([System.IO.Path]::GetTempPath()) "git-watcher-follow-$PID.txt"
        [System.IO.File]::WriteAllText($script:followFile, $repositoryPath)
        if (-not $script:followHookInstalled) {
            # Keep any handler that was already there (from a profile or another module), and run it first. The new
            # handler is made here, in the module, so it can see the module's variables and functions.
            $script:previousLocationChangedAction = $ExecutionContext.InvokeCommand.LocationChangedAction
            $ExecutionContext.InvokeCommand.LocationChangedAction = {
                param($changeSource, $changeArgs)
                if ($script:previousLocationChangedAction) {
                    $script:previousLocationChangedAction.Invoke($changeSource, $changeArgs)
                }
                Update-GitWatcherFollowFile $changeArgs
            }
            $script:followHookInstalled = $true
        }
        $arguments += " --follow-file `"$($script:followFile)`""
    }

    Start-Process -FilePath $executable `
        -ArgumentList $arguments `
        -WorkingDirectory (Split-Path $executable)
}

Export-ModuleMember -Function Start-GitWatcher
