namespace GitWatcher.Overlay;

/// <summary>
/// Raises events when the terminal window moves, resizes, is restored, or is destroyed.
/// </summary>
/// <remarks>
/// Uses out-of-context WinEvent hooks scoped to the terminal's process, so nothing is injected into the terminal.
/// Windows delivers the events on the thread that set the hooks, which is the WPF UI thread here.
/// </remarks>
internal sealed class TerminalWindowTracker : IDisposable
{
    private readonly nint _window;
    private readonly List<nint> _hooks = [];

    // The hooks call this delegate from native code, so it must stay referenced for as long as they exist.
    private readonly NativeMethods.WinEventProc _callback;

    public TerminalWindowTracker(nint window)
    {
        _window = window;
        _callback = OnWinEvent;
        NativeMethods.GetWindowThreadProcessId(window, out uint processId);

        uint[] events =
        [
            NativeMethods.EventObjectLocationChange,
            NativeMethods.EventSystemMinimizeEnd,
            NativeMethods.EventObjectDestroy,
        ];
        foreach (uint eventType in events)
        {
            nint hook = NativeMethods.SetWinEventHook(
                eventType,
                eventType,
                0,
                _callback,
                processId,
                0,
                NativeMethods.WinEventOutOfContext);
            if (hook != 0)
            {
                _hooks.Add(hook);
            }
        }
    }

    public event EventHandler? Moved;

    public event EventHandler? Closed;

    public void Dispose()
    {
        foreach (nint hook in _hooks)
        {
            NativeMethods.UnhookWinEvent(hook);
        }

        _hooks.Clear();
    }

    private void OnWinEvent(nint hook, uint eventType, nint window, int objectId, int childId, uint eventThread, uint eventTime)
    {
        // The terminal's process also reports events for carets, child windows, and other objects. Only the
        // terminal window itself matters.
        if (window != _window || objectId != NativeMethods.ObjectIdWindow || childId != NativeMethods.ChildIdSelf)
        {
            return;
        }

        if (eventType == NativeMethods.EventObjectDestroy)
        {
            Closed?.Invoke(this, EventArgs.Empty);
        }
        else
        {
            Moved?.Invoke(this, EventArgs.Empty);
        }
    }
}
