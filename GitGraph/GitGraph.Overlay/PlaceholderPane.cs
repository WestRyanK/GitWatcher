using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace GitGraph.Overlay;

/// <summary>
/// An empty Windows Terminal pane, split off the right side of the current tab, that reserves room for the overlay.
/// </summary>
/// <remarks>
/// The overlay can't make Windows Terminal leave room for it, but a real pane can: the shell's pane gets narrower and
/// its text wraps before the overlay. The pane runs a small PowerShell loop that keeps it open until the overlay
/// signals it to close, or the overlay's process is gone. When the loop ends, Windows Terminal closes the pane.
/// </remarks>
internal sealed class PlaceholderPane : IDisposable
{
    private static int s_splitCount;

    private readonly EventWaitHandle _closeSignal;
    private readonly string _aliveSignalName;

    private PlaceholderPane(string title, EventWaitHandle closeSignal, string aliveSignalName)
    {
        Title = title;
        _closeSignal = closeSignal;
        _aliveSignalName = aliveSignalName;
    }

    /// <summary>The pane's title, which identifies it among the window's panes in UI Automation.</summary>
    public string Title { get; }

    public DateTime SplitAt { get; } = DateTime.UtcNow;

    /// <summary>Whether the pane's process is still running, which means the pane is still open.</summary>
    public bool IsOpen
    {
        get
        {
            if (!EventWaitHandle.TryOpenExisting(_aliveSignalName, out EventWaitHandle? aliveSignal))
            {
                return false;
            }

            aliveSignal.Dispose();
            return true;
        }
    }

    /// <summary>
    /// Splits the active tab of the most recently used Windows Terminal window, and returns the new pane, or null
    /// if Windows Terminal couldn't be started.
    /// </summary>
    /// <param name="widthFraction">The new pane's share of the tab's width.</param>
    public static PlaceholderPane? Split(double widthFraction)
    {
        int processId = Environment.ProcessId;
        int splitNumber = Interlocked.Increment(ref s_splitCount);
        string name = $"GitGraph.Overlay.{processId}.{splitNumber}";
        string closeSignalName = $@"Local\{name}.Close";
        string aliveSignalName = $@"Local\{name}.Alive";
        string title = $"Git Graph {processId}-{splitNumber}";

        // Each split gets its own signals. A signal that's already set can't be reused, because a new pane would
        // see it and close at once.
        EventWaitHandle closeSignal = new(false, EventResetMode.ManualReset, closeSignalName);

        // Windows PowerShell 5.1 comes with every version of Windows. The script exits if the overlay closed before
        // it started, holds the alive signal open while it runs, and checks for the overlay twice a second.
        string script = $$"""
            try { $close = [Threading.EventWaitHandle]::OpenExisting('{{closeSignalName}}') } catch { exit }
            $alive = New-Object Threading.EventWaitHandle($false, 'ManualReset', '{{aliveSignalName}}')
            [Console]::CursorVisible = $false
            Clear-Host
            while (-not $close.WaitOne(500)) {
                if (-not (Get-Process -Id {{processId}} -ErrorAction SilentlyContinue)) { break }
            }
            """;
        string encodedScript = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));

        ProcessStartInfo startInfo = new("wt.exe") { UseShellExecute = false, CreateNoWindow = true };
        string[] arguments =
        [
            "--window", "0",
            "split-pane",
            "--vertical",
            "--size", Math.Clamp(widthFraction, 0.1, 0.9).ToString("0.###", CultureInfo.InvariantCulture),
            "--title", title,
            "--suppressApplicationTitle",
            "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript,

            // The new pane takes focus. Give it back to the shell, which is the pane that was split.
            ";", "move-focus", "left",
        ];
        foreach (string argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        try
        {
            using Process? process = Process.Start(startInfo);
        }
        catch (Win32Exception)
        {
            closeSignal.Dispose();
            return null;
        }

        return new PlaceholderPane(title, closeSignal, aliveSignalName);
    }

    /// <summary>Closes the pane.</summary>
    public void Dispose()
    {
        _closeSignal.Set();
        _closeSignal.Dispose();
    }
}
