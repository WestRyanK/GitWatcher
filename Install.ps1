$ScriptName = "GitWatcher"
$Documents = [Environment]::GetFolderPath("MyDocuments")
$DestinationPath = [IO.Path]::Combine("$Documents", "PowerShell", "Modules", "$ScriptName")
$null = New-Item -Path $DestinationPath -ItemType Directory -Force
$SourcePath = [IO.Path]::Combine("$PSScriptRoot", "$ScriptName.psm1")
Copy-Item -Path $SourcePath -Destination "$DestinationPath" -Recurse -Force
Import-Module GitWatcher -Force
Write-Host "Installed GitWatcher module in '$DestinationPath'"