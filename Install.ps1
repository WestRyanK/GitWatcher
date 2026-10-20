<#
.SYNOPSIS
    Installs the GitWatcher PowerShell module, which adds the Start-GitWatcher command.

.DESCRIPTION
    Adds a GitWatcher module to your PowerShell modules folder (Documents\PowerShell\Modules). The module points
    back at this clone, so Start-GitWatcher always runs this clone's current code: pulling updates is enough, and
    there's no need to install again unless you move the clone.
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
