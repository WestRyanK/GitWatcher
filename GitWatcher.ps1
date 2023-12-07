param(
    [string] $Path,
    [ValidateSet("Graph", "Status")] [String] $GitCommand = "Graph",
    [double] $UpdateDelaySeconds = 0.5,
    [string] $LiveMessage = "`e[32m(● Live)`e[0m"
)

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



$LastChange = $null

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

$Watcher = New-Object System.IO.FileSystemWatcher $WatchPath -Property @{
    IncludeSubdirectories = $True
    EnableRaisingEvents = $True
    Filter = "*.*"
}
$ChangeTypes = [System.IO.WatcherChangeTypes]::Created,[System.IO.WatcherChangeTypes]::Changed,[System.IO.WatcherChangeTypes]::Deleted,[System.IO.WatcherChangeTypes]::Renamed
$Timeout = New-TimeSpan -Milliseconds 100


Write-Git $Path $LiveMessage $GitCommand

$Continue = $True
while ($Continue) {
    $Host.UI.RawUI.FlushInputBuffer()

    $Result = $Watcher.WaitForChanged($ChangeTypes, $Timeout)
    if ($Result.TimedOut -eq $False -and $Result.Name -notlike "*.lock") {
        $LastChange = Get-Date
    }

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
    if ($null -ne $LastChange -and (New-TimeSpan -Start $LastChange -End (Get-Date)).TotalSeconds -gt $UpdateDelaySeconds) {
        Write-Git $Path $LiveMessage $GitCommand
        $LastChange = $null
    }
}