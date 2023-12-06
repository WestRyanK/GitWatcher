Function Register-FileSystemWatcher {
    param (
        [string] $Folder,
        [scriptblock] $Action
    )

    $Folder = $Folder | Resolve-Path
    $Filter = "*.*"
    $Watcher = New-Object System.IO.FileSystemWatcher $Folder, $Filter -Property @{
        IncludeSubdirectories = $True
        EnableRaisingEvents = $True
    }

    Register-ObjectEvent $Watcher -EventName "Changed" -Action $Action
    Register-ObjectEvent $Watcher -EventName "Created" -Action $Action
    Register-ObjectEvent $Watcher -EventName "Deleted" -Action $Action
}

Function Write-GitLog {
    param([switch] $Page)
    Clear-Host
    if ($Page) {
        git log --graph --oneline --branches
    }
    else {
        git --no-pager log --graph --oneline --branches -22
    }
}

$global:IsUpdateAvailable = $False
$GitFolder = ".git"
$Job = Register-FileSystemWatcher $GitFolder -Action {
    # Write-Host $Event.SourceEventArgs.ChangeType
    # Write-Host $Event.SourceEventArgs.FullPath
    $global:IsUpdateAvailable = $True
}

try {
    while ($True) {
        $IsKeyDown = [System.Console]::KeyAvailable;
        $Host.UI.RawUI.FlushInputBuffer()
        Start-Sleep -Seconds .25
        if ($IsKeyDown) {
            Write-GitLog -Page
        }
        if ($global:IsUpdateAvailable) {
            Write-GitLog
            $global:IsUpdateAvailable = $False
        }
    }
}
finally {
    Get-EventSubscriber -Force | Unregister-Event -Force
    Get-Job | Stop-Job
    Get-Job | Remove-Job
}