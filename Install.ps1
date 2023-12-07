$ScriptName = "GitWatcher"
$DestinationPath = "$Home/Documents/PowerShell/Modules/$ScriptName"
$null = New-Item -Path $DestinationPath -ItemType Directory -Force
Copy-Item -Path "$PSScriptRoot/$ScriptName.psm1" -Destination "$DestinationPath" -Recurse -Force
Import-Module GitWatcher -Force
Write-Host "Installed GitWatcher module in '$DestinationPath'"