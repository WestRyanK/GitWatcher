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
        $CommitCount = $Host.UI.RawUI.WindowSize.Height
        $LogRows = git -C "$Path" --no-pager log --graph --oneline --branches --decorate --color=always -$CommitCount
        $MaxRowCount = $CommitCount - 1
        $LogRows = $LogRows[0..($MaxRowCount - 1)]
        $LogString = $LogRows | Join-String -Separator "`n"
        Write-Host $LogString
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

    $Continue = $True
    while ($Continue) {
        $Host.UI.RawUI.FlushInputBuffer()
        Start-Sleep -Seconds .05
        $IsKeyDown = [System.Console]::KeyAvailable;
        if ($IsKeyDown) {
            $PressedKey = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
            if ($PressedKey.Character -eq "q") {
                $Continue = $False
            }
            else {
                Write-GitLog $Path -Page
                Write-GitLog $Path
            }
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