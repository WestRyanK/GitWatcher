using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace GitWatcher.Overlay;

/// <summary>
/// Keeps to one standalone window per repository: the window showing a repository holds its lock, and starting or
/// switching another window to that repository brings the holder to the front instead.
/// </summary>
/// <remarks>
/// The lock is a named event per folder. Taking a lock that another process holds signals the event, which that
/// process waits on, and lets it take the foreground, which only the process the user is using may give it.
/// </remarks>
internal sealed class FolderLock : IDisposable
{
    private readonly EventWaitHandle _event;
    private readonly RegisteredWaitHandle _wait;

    private FolderLock(EventWaitHandle signal)
    {
        _event = signal;
        _wait = ThreadPool.RegisterWaitForSingleObject(
            signal,
            (_, _) => Requested?.Invoke(this, EventArgs.Empty),
            null,
            Timeout.Infinite,
            executeOnlyOnce: false);
    }

    /// <summary>Raised, on a thread pool thread, when another process asks for this lock's window.</summary>
    public event EventHandler? Requested;

    /// <summary>
    /// Takes the lock for <paramref name="folder"/>, or returns null after asking the window that holds it to come
    /// to the front.
    /// </summary>
    public static FolderLock? TryTake(string folder)
    {
        string normalized = Path.TrimEndingDirectorySeparator(folder).ToUpperInvariant();
        string key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)));
        EventWaitHandle signal = new(false, EventResetMode.AutoReset, $@"Local\GitWatcher.Window.{key}", out bool createdNew);
        if (createdNew)
        {
            return new FolderLock(signal);
        }

        NativeMethods.AllowSetForegroundWindow(NativeMethods.AllowSetForegroundAnyProcess);
        signal.Set();
        signal.Dispose();
        return null;
    }

    public void Dispose()
    {
        _wait.Unregister(null);
        _event.Dispose();
    }
}
