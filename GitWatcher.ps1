param(
    [string] $Path,
    [ValidateSet("Graph", "Status")] [String] $GitCommand = "Graph"
)

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

Function Write-ClippedCommandOutput {
    param([ScriptBlock] $Command)

    $MaxLines = $Host.UI.RawUI.WindowSize.Height - 1
    $Lines = Invoke-Command $Command -ArgumentList $MaxLines
    $ClippedLines = $Lines[0..($MaxLines - 1)]
    $Output = $ClippedLines | Join-String -Separator "`n"
    Write-Host $Output
}

Function Write-GitGraph {
    param([string] $Path, [switch] $Paginate)


    Clear-Host
    if ($Paginate) {
        git -C "$Path" log --graph --oneline --branches
    }
    else {
        Write-ClippedCommandOutput {
            git -C "$Path" --no-pager log --graph --oneline --branches --decorate --color=always -$MaxLines
        }
    }
}

Function Write-GitStatus {
    param([string] $Path, [switch] $Paginate)

    Clear-Host
    if ($Paginate) {
        git -c color.status=always -C "$Path" -p status
    }
    else {
        Write-ClippedCommandOutput {
            git -c color.status=always -C "$Path" status
        }
    }
}

Function Write-Git {
    param([string] $Path, [switch] $Paginate, $GitCommand)
    if ($GitCommand -eq "Graph") {
        Write-GitGraph -Path $Path -Paginate:$Paginate
    }
    elseif ($GitCommand -eq "Status") {
        Write-GitStatus -Path $Path -Paginate:$Paginate
    }
}



$global:IsUpdateAvailable = $False

if ([String]::IsNullOrWhiteSpace($Path)) {
    $Path = "."
}
$Path = $Path | Resolve-Path
if ($GitCommand -eq "Graph") {
    $GitFolder = ".git"
    $WatchPath = [System.IO.Path]::Combine($Path, $GitFolder)
}
else {
    $WatchPath = $Path
}

$Job = Register-FileSystemWatcher $WatchPath -Action {
    $FileName = Split-Path $Event.SourceEventArgs.FullPath -Leaf
    if ($FileName -like "*.lock") {
        return
    }
    $global:IsUpdateAvailable = $True
}


try {
    Write-Git $Path $GitCommand

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
                Write-Git $Path -Paginate $GitCommand
                Write-Git $Path $GitCommand
            }
        }
        if ($global:IsUpdateAvailable) {
            Write-Git $Path $GitCommand
            $global:IsUpdateAvailable = $False
        }
    }
}
finally {
    Get-EventSubscriber -Force | Unregister-Event -Force
    Get-Job | Stop-Job
    Get-Job | Remove-Job
}