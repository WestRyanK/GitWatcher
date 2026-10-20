<#
.SYNOPSIS
    Installs the GitWatcher PowerShell module (Start-GitWatcher) and the /git-watcher Claude Code skill.

.DESCRIPTION
    Adds a GitWatcher module to your PowerShell modules folder (Documents\PowerShell\Modules), and a git-watcher
    skill to your Claude Code skills folder (~/.claude/skills, or CLAUDE_CONFIG_DIR\skills). Both point back at
    this clone, so they always run this clone's current code. Install again after you move the clone, or after an
    update changes the skill.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$moduleName = 'GitWatcher'
$documents = [Environment]::GetFolderPath('MyDocuments')
$destinationPath = [IO.Path]::Combine($documents, 'PowerShell', 'Modules', $moduleName)
$null = New-Item -Path $destinationPath -ItemType Directory -Force

# The earlier installer copied the whole module here. The manifest below points at this clone instead.
Remove-Item -LiteralPath (Join-Path $destinationPath "$moduleName.psm1") -ErrorAction SilentlyContinue

$rootModule = Join-Path $PSScriptRoot "$moduleName.psm1"
$manifest = Join-Path $destinationPath "$moduleName.psd1"
New-ModuleManifest -Path $manifest `
    -RootModule $rootModule `
    -ModuleVersion '2.0.0' `
    -Author 'Ryan West' `
    -Description 'Docks Git Watcher, a live git graph viewer, beside the current terminal.' `
    -FunctionsToExport 'Start-GitWatcher' `
    -CmdletsToExport @() `
    -VariablesToExport @() `
    -AliasesToExport @()

Import-Module $manifest -Force
Write-Host "Installed the $moduleName module in '$destinationPath'. Run Start-GitWatcher in any repository."

# The Claude Code skill is a template with this clone's server path filled in, installed for the user so that
# /git-watcher works in every repository.
$claudeDirectory = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$skillDirectory = [IO.Path]::Combine($claudeDirectory, 'skills', 'git-watcher')
$null = New-Item -Path $skillDirectory -ItemType Directory -Force
$serverPath = (Join-Path $PSScriptRoot 'GitWatcher.Server\server.js').Replace('\', '/')
$skill = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'GitWatcher.Skill\SKILL.md') -Raw).Replace('{{ServerPath}}', $serverPath)
[IO.File]::WriteAllText((Join-Path $skillDirectory 'SKILL.md'), $skill, [Text.UTF8Encoding]::new($false))
Write-Host "Installed the git-watcher Claude Code skill in '$skillDirectory'. Type /git-watcher in Claude Code to open the viewer."
