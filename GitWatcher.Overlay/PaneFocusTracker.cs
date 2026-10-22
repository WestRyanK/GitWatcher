using System.Windows.Automation;

namespace GitWatcher.Overlay;

/// <summary>
/// Raises an event when one of a Windows Terminal window's panes gets the keyboard focus.
/// </summary>
/// <remarks>
/// UI Automation reports focus changes anywhere on the desktop, on one of its own threads. The properties this needs
/// are cached with each event, so telling the terminal's panes apart costs no cross-process calls.
/// </remarks>
internal sealed class PaneFocusTracker : IDisposable
{
    private readonly int _processId;
    private readonly AutomationFocusChangedEventHandler _handler;
    private readonly Task _subscribed;

    public PaneFocusTracker(nint terminalWindow)
    {
        NativeMethods.GetWindowThreadProcessId(terminalWindow, out uint processId);
        _processId = (int)processId;
        _handler = OnFocusChanged;

        // Subscribing is a cross-process call, so it's kept off the UI thread.
        _subscribed = Task.Run(() =>
        {
            CacheRequest cache = new();
            cache.Add(AutomationElement.ProcessIdProperty);
            cache.Add(AutomationElement.ClassNameProperty);
            cache.Add(AutomationElement.NameProperty);
            using (cache.Activate())
            {
                Automation.AddAutomationFocusChangedEventHandler(_handler);
            }
        });
    }

    /// <summary>Raised on a UI Automation thread with the title of the pane that got the focus.</summary>
    public event EventHandler<string>? PaneFocused;

    public void Dispose()
    {
        _subscribed.ContinueWith(_ => Automation.RemoveAutomationFocusChangedEventHandler(_handler), TaskScheduler.Default);
    }

    private void OnFocusChanged(object sender, AutomationFocusChangedEventArgs e)
    {
        try
        {
            if (sender is AutomationElement element
                && element.Cached.ProcessId == _processId
                && element.Cached.ClassName == TerminalWindow.TerminalPaneClassName)
            {
                PaneFocused?.Invoke(this, element.Cached.Name);
            }
        }
        catch (Exception exception) when (exception is ElementNotAvailableException or InvalidOperationException)
        {
            // The element went away, or a property wasn't cached.
        }
    }
}
