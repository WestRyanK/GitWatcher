Function Format-AnsiEscapedString {
    param([string] $AnsiString, [int] $MaxLength)

    $IsInEscape = $False
    for (($i = 0), ($Count = 0); ($i -lt $AnsiString.Length) -and ($Count -lt $MaxLength); $i++) {
        $Char = $AnsiString[$i]
        if ($Char -eq "`e") {
            $IsInEscape = $True
        }
        if (!($IsInEscape)) {
            $Count++
        }
        if ($Char -eq "m") {
            $IsInEscape = $False
        }
    }

    $ResizedString = $AnsiString.Substring(0, $i)
    return $ResizedString
}

Function Format-WrappedAnsiEscapedLines {
    param([Object[]] $Lines, [int] $WrapWidth, [int] $MaxLines)

    $OutputLines = @()
    for (($i = 0), ($Count = 0); ($i -lt $Lines.Length -and $Count -lt $MaxLines); ($i++)) {

        $Line = $Lines[$i]
        while ($Line.Length -gt 0 -and $Count -lt $MaxLines) {
            $WrappedLine = Format-AnsiEscapedString $Line $WrapWidth
            $OutputLines += $WrappedLine
            $Count++
            $Line = $Line.Substring($WrappedLine.Length, $Line.Length - $WrappedLine.Length)
        }
    }
    return $OutputLines
}

Function Write-ClippedCommandOutput {
    param(
        [ScriptBlock] $Command,
        [ValidateSet("Wrap", "Clip")] [string] $LineMode
    )

    $Size = $Host.UI.RawUI.WindowSize
    $MaxLines = $Size.Height - 1
    $Lines = Invoke-Command $Command -ArgumentList $MaxLines
    if ($LineMode -eq "Wrap") {
        $FormattedLines = Format-WrappedAnsiEscapedLines $Lines $Size.Width $MaxLines
    }
    elseif ($LineMode -eq "Clip") {
        $FormattedLines = $Lines | Foreach-Object { Format-AnsiEscapedString $_ $Size.Width }
        $FormattedLines = $FormattedLines[0..($MaxLines - 1)]
    }
    $Output = $FormattedLines | Join-String -Separator "`n"
    Clear-Host
    Write-Host $Output
}

Function Write-GitGraph {
    param(
        [string] $Path,
        [switch] $Paginate,
        [ValidateSet("Wrap", "Clip")] [string] $LineMode
    )

    if ($Paginate) {
        git -C "$Path" log --graph --oneline --branches
    }
    else {
        Write-ClippedCommandOutput -LineMode $LineMode {
            git -C "$Path" --no-pager log --graph --oneline --branches --decorate --color=always -$MaxLines
        }
    }
}

Function Write-GitStatus {
    param(
        [string] $Path,
        [switch] $Paginate,
        [ValidateSet("Wrap", "Clip")] [string] $LineMode
    )

    if ($Paginate) {
        git -c color.status=always -C "$Path" -p status
    }
    else {
        Write-ClippedCommandOutput -LineMode $LineMode {
            git -c color.status=always -C "$Path" status
        }
    }
}

Function Write-Git {
    param(
        [string] $Path,
        [string] $LiveMessage,
        [string] $RepoName,
        [string] $GitCommand,
        [switch] $Paginate,
        [ValidateSet("Wrap", "Clip")] [string] $LineMode
    )

    if ($GitCommand -eq "Graph") {
        Write-GitGraph -Path $Path -Paginate:$Paginate -LineMode $LineMode
    }
    elseif ($GitCommand -eq "Status") {
        Write-GitStatus -Path $Path -Paginate:$Paginate -LineMode $LineMode
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

Function Test-GitPath {
    param([string] $Path)
    ($Result = (git -C $Path rev-parse --is-inside-work-tree)) 2> $null
    return $Result -eq "true"
}

Function Watch-Git {
    param(
        [string] $Path,
        [ValidateSet("Graph", "Status")] [String] $GitCommand = "Graph",
        [double] $UpdateDelaySeconds = 0.5,
        [string] $LiveMessage = "`e[32m(● Live in '{0}')`e[0m",
        [ValidateSet("Wrap", "Clip")] [string] $LineMode = "Wrap"
    )

    if ([String]::IsNullOrWhiteSpace($Path)) {
        $Path = "."
    }
    $Path = $Path | Resolve-Path
    $RepoName = $Path | Split-Path -Leaf
    if (!(Test-GitPath $Path)) {
        Write-Error "not a git repository: $Path"
        return
    }

    $WatchPath = if ($GitCommand -eq "Graph") { [System.IO.Path]::Combine($Path, ".git") } else { $Path }
    Initialize-FileSystemWatcher $WatchPath

    $LastChange = [DateTime]::MinValue
    $Continue = $True
    while ($Continue) {
        $IsUpdateAvailable = $null -ne $LastChange -and (New-TimeSpan -Start $LastChange -End (Get-Date)).TotalSeconds -gt $UpdateDelaySeconds
        if ($IsUpdateAvailable) {
			Write-Git $Path $LiveMessage $RepoName $GitCommand -LineMode $LineMode
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
				Write-Git $Path $LiveMessage $RepoName $GitCommand -Paginate -LineMode $LineMode
				Write-Git $Path $LiveMessage $RepoName $GitCommand -LineMode $LineMode
			}
		}

        $WindowSize = $Host.UI.RawUI.WindowSize
        if ($LastWindowSize -ne $WindowSize) {
            $LastChange = Get-Date
        }
        $LastWindowSize = $WindowSize
	}
}

Function Start-GitWatcher {
    param([string] $Path, [switch] $QuakeMode)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        $Path = Get-Location
    }

    if (!(Test-GitPath $Path)) {
        Write-Error "not a git repository: $Path"
        return
    }

    $Window = if ($QuakeMode) { "_quake" } else { "0" }
    $ArgString = "-w $Window split-pane --{0} pwsh -Command & {{ Set-Location '$Path' \; Watch-Git {1} }}"
    $GraphPaneArgs = $ArgString -f "vertical", ""
    $StatusPaneArgs = $ArgString -f "horizontal", "-GitCommand Status"
    $PaneArgs = "$GraphPaneArgs; $StatusPaneArgs"
    Start-Process wt -ArgumentList $PaneArgs
}

Function Start-QuakeGitWatcher {
    Start-GitWatcher -Quake $Args
}

Export-ModuleMember -Function Watch-Git
Export-ModuleMember -Function Start-GitWatcher
Export-ModuleMember -Function Start-QuakeGitWatcher