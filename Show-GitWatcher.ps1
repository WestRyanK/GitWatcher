<#
.SYNOPSIS
    Docks Git Watcher, the live git graph viewer, to the right side of the current terminal window.

.DESCRIPTION
    Starts GitWatcher.Overlay, a small WPF app that shows Git Watcher for a repository in
    a panel docked to the right side of the terminal window you run this from. In Windows Terminal it splits the
    current tab and covers the new pane, so your shell's text wraps before the panel. The panel follows the window
    when you move or resize it, hides when you minimize it or switch tabs, and closes when you close the window or
    this shell.

    The first run builds the app (it needs the .NET 10 SDK), and so does any run after its sources change. The
    viewer also needs Node.js on PATH and the WebView2 runtime, which comes with Windows 11.

.PARAMETER Path
    The folder whose repository to show. Defaults to the current directory.

.EXAMPLE
    .\Show-GitWatcher.ps1

    Shows the current directory's repository next to this terminal.

.EXAMPLE
    Set-Alias gw D:\source\GitHub\GitWatcher\Show-GitWatcher.ps1

    Add this to your PowerShell profile to open the overlay by typing gw.
#>
[CmdletBinding()]
param(
    [string]$Path = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

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

$repositoryPath = (Resolve-Path -LiteralPath $Path).ProviderPath

# A trailing backslash would escape the closing quote, as in "C:\".
if ($repositoryPath.EndsWith('\')) {
    $repositoryPath += '.'
}

# The app finds this terminal's window through the console of its parent process, which is this shell. Passing
# the shell's process ID closes the overlay when this shell (or its tab) closes.
Start-Process -FilePath $executable `
    -ArgumentList "--repo `"$repositoryPath`" --shell-process $PID" `
    -WorkingDirectory $repositoryPath
