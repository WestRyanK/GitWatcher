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

$GitFolder = ".git"
Register-FileSystemWatcher $GitFolder -Action {
    Write-Host $Event.SourceEventArgs.ChangeType
    Write-Host $Event.SourceEventArgs.FullPath
}