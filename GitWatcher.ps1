param(
    [string] $Path,
    [ValidateSet("Graph", "Status")] [String] $GitCommand = "Graph",
    [double] $UpdateDelaySeconds = 0.5,
    [string] $LiveMessage = "`e[32m(● Live)`e[0m"
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
    Clear-Host
    Write-Host $Output
}

Function Write-GitGraph {
    param([string] $Path, [switch] $Paginate)

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
    param([string] $Path, [string] $LiveMessage, [string] $GitCommand, [switch] $Paginate)
    if ($GitCommand -eq "Graph") {
        Write-GitGraph -Path $Path -Paginate:$Paginate
    }
    elseif ($GitCommand -eq "Status") {
        Write-GitStatus -Path $Path -Paginate:$Paginate
    }
    if (!$Paginate) {
        Write-Host $LiveMessage -NoNewline
    }
}



$global:LastChange = $null

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
    $global:LastChange = Get-Date
}


try {
    Write-Git $Path $LiveMessage $GitCommand

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
                Write-Git $Path $LiveMessage $GitCommand -Paginate
                Write-Git $Path $LiveMessage $GitCommand
            }
        }
        if ($null -ne $global:LastChange -and (New-TimeSpan -Start $global:LastChange -End (Get-Date)).TotalSeconds -gt $UpdateDelaySeconds) {
            Write-Git $Path $LiveMessage $GitCommand
            $global:LastChange = $null
        }
    }
}
finally {
    Get-EventSubscriber -Force | Unregister-Event -Force
    Get-Job | Stop-Job
    Get-Job | Remove-Job
}