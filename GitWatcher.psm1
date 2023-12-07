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
    param([string] $Path, [string] $LiveMessage, [string] $RepoName, [string] $GitCommand, [switch] $Paginate)
    if ($GitCommand -eq "Graph") {
        Write-GitGraph -Path $Path -Paginate:$Paginate
    }
    elseif ($GitCommand -eq "Status") {
        Write-GitStatus -Path $Path -Paginate:$Paginate
    }
    if (!$Paginate) {
        $FormattedMessage = $LiveMessage -f $RepoName
        Write-Host $FormattedMessage -NoNewline
    }
}

Function Initialize-FileSystemWatcher {
    param([string] $Path)

    $script:Watcher = New-Object System.IO.FileSystemWatcher $WatchPath -Property @{
        IncludeSubdirectories = $True
        EnableRaisingEvents = $True
        Filter = "*.*"
    }
    $script:ChangeTypes = [System.IO.WatcherChangeTypes]::Created,[System.IO.WatcherChangeTypes]::Changed,[System.IO.WatcherChangeTypes]::Deleted,[System.IO.WatcherChangeTypes]::Renamed
    $script:Timeout = New-TimeSpan -Milliseconds 100
}

Function Wait-FileSystemChange {
    $Result = $script:Watcher.WaitForChanged($script:ChangeTypes, $script:Timeout)
    return $Result.TimedOut -eq $False -and $Result.Name -notlike "*.lock"
}


Function Watch-Git {
    param(
        [string] $Path,
        [ValidateSet("Graph", "Status")] [String] $GitCommand = "Graph",
        [double] $UpdateDelaySeconds = 0.5,
        [string] $LiveMessage = "`e[32m(● Live in '{0}')`e[0m"
    )

    if ([String]::IsNullOrWhiteSpace($Path)) {
        $Path = "."
    }
    $Path = $Path | Resolve-Path
    $RepoName = $Path | Split-Path -Leaf
    if ($GitCommand -eq "Graph") {
        $WatchPath = [System.IO.Path]::Combine($Path, ".git")
    }
    else {
        $WatchPath = $Path
    }
    Initialize-FileSystemWatcher $WatchPath

    $LastChange = [DateTime]::MinValue
    $Continue = $True
    while ($Continue) {
        $IsUpdateAvailable = $null -ne $LastChange -and (New-TimeSpan -Start $LastChange -End (Get-Date)).TotalSeconds -gt $UpdateDelaySeconds
        if ($IsUpdateAvailable) {
			Write-Git $Path $LiveMessage $RepoName $GitCommand
			$LastChange = $null
		}

        $Host.UI.RawUI.FlushInputBuffer()

        if (Wait-FileSystemChange) {
            $LastChange = Get-Date
        }

		$IsKeyDown = [System.Console]::KeyAvailable;
		if ($IsKeyDown) {
			$PressedKey = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
			if ($PressedKey.Character -eq "q") {
				$Continue = $False
			}
			else {
				Write-Git $Path $LiveMessage $RepoName $GitCommand -Paginate
				Write-Git $Path $LiveMessage $RepoName $GitCommand
			}
		}

        $WindowSize = $Host.UI.RawUI.WindowSize
        if ($LastWindowSize -ne $WindowSize) {
            $LastChange = Get-Date
        }
        $LastWindowSize = $WindowSize
	}
}

Export-ModuleMember -Function Watch-Git