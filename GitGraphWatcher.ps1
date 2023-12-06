param([string] $Path)

Function Register-FileSystemWatcher {
    param ( [string] $Path, [scriptblock] $Action)

    $Filter = "*.*"
    $Watcher = New-Object System.IO.FileSystemWatcher $Path, $Filter -Property @{
        IncludeSubdirectories = $True
        EnableRaisingEvents = $True
    }

    Register-ObjectEvent $Watcher -EventName "Changed" -Action $Action
    Register-ObjectEvent $Watcher -EventName "Created" -Action $Action
    Register-ObjectEvent $Watcher -EventName "Deleted" -Action $Action
}

Function Write-GitLog {
    param([string] $Path, [switch] $Page)

    Clear-Host
    if ($Page) {
        git -C "$Path" log --graph --oneline --branches
    }
    else {
        git -C "$Path" --no-pager log --graph --oneline --branches -22
    }
}



$global:IsUpdateAvailable = $False

if ([String]::IsNullOrWhiteSpace($Path)) {
    $Path = "."
}
$Path = $Path | Resolve-Path
$GitFolder = ".git"
$WatchPath = [System.IO.Path]::Combine($Path, $GitFolder)

$Job = Register-FileSystemWatcher $WatchPath -Action {
    $FileName = Split-Path $Event.SourceEventArgs.FullPath -Leaf
    if ($FileName -like "*.lock") {
        return
    }
    $global:IsUpdateAvailable = $True
}


try {
    Write-GitLog $Path

    while ($True) {
        $IsKeyDown = [System.Console]::KeyAvailable;
        $Host.UI.RawUI.FlushInputBuffer()
        Start-Sleep -Seconds .25
        if ($IsKeyDown) {
            Write-GitLog $Path -Page
            Write-GitLog $Path
        }
        if ($global:IsUpdateAvailable) {
            Write-GitLog $Path
            $global:IsUpdateAvailable = $False
        }
    }
}
finally {
    Get-EventSubscriber -Force | Unregister-Event -Force
    Get-Job | Stop-Job
    Get-Job | Remove-Job
}