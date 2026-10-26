using System.IO;

namespace GitWatcher.Overlay;

/// <summary>
/// The repository a standalone window shows: one the user picked, or, with <c>-Follow</c>, the one its shell is in.
/// </summary>
/// <remarks>
/// The window's server follows a file of the window's own, the way a docked overlay's server follows its shell's file,
/// so the window can switch repositories without restarting the server. The window writes the file when the user
/// picks a repository. While it follows a shell, it copies the shell's file into it instead, until the user picks a
/// repository, which ends following.
/// </remarks>
internal sealed class WindowFolder : IDisposable
{
    private readonly object _gate = new();
    private FolderLock? _lock;
    private string? _shellFile;
    private FileSystemWatcher? _shellWatcher;

    private WindowFolder(string? current, FolderLock? folderLock)
    {
        FollowFile = Path.Combine(Path.GetTempPath(), $"git-watcher-window-{Environment.ProcessId}.txt");
        Current = current;
        SetLock(folderLock);
    }

    /// <summary>Raised, on a thread pool thread, when another window or start asks for this window's repository.</summary>
    public event EventHandler? Requested;

    /// <summary>The file the server follows.</summary>
    public string FollowFile { get; }

    /// <summary>The top folder of the repository the user picked, or null while following a shell.</summary>
    public string? Current { get; private set; }

    public bool Following => _shellFile is not null;

    /// <summary>
    /// Starts showing <paramref name="repositoryPath"/>, or following <paramref name="shellFollowFile"/> when it's
    /// given. Returns null when another window already shows that repository, after bringing it to the front.
    /// </summary>
    public static async Task<WindowFolder?> OpenAsync(string repositoryPath, string? shellFollowFile)
    {
        if (shellFollowFile is not null)
        {
            // A window that follows a shell can move to any repository, so it holds no repository's lock.
            WindowFolder following = new(null, null);
            following.WriteFollowFile(repositoryPath);
            following.StartFollowing(shellFollowFile);
            return following;
        }

        string topLevel = await GitFolder.GetTopLevelAsync(repositoryPath) ?? repositoryPath;
        if (FolderLock.TryTake(topLevel) is not FolderLock folderLock)
        {
            return null;
        }

        WindowFolder folder = new(topLevel, folderLock);
        folder.WriteFollowFile(topLevel);
        WindowSettings.Update(settings => settings.AddRecentFolder(topLevel));
        return folder;
    }

    /// <summary>Switches to the repository that <paramref name="folder"/> is in.</summary>
    public async Task<FolderSwitch> SwitchToAsync(string folder)
    {
        string? topLevel = await GitFolder.GetTopLevelAsync(folder);
        if (topLevel is null)
        {
            return FolderSwitch.NotRepository;
        }

        if (!Following && GitFolder.AreSame(topLevel, Current))
        {
            return FolderSwitch.AlreadyShown;
        }

        if (FolderLock.TryTake(topLevel) is not FolderLock folderLock)
        {
            return FolderSwitch.ShownInAnotherWindow;
        }

        StopFollowing();
        SetLock(folderLock);
        Current = topLevel;
        WriteFollowFile(topLevel);
        WindowSettings.Update(settings => settings.AddRecentFolder(topLevel));
        return FolderSwitch.Switched;
    }

    public void Dispose()
    {
        StopFollowing();
        SetLock(null);
        DeleteFile(FollowFile);
    }

    private void SetLock(FolderLock? folderLock)
    {
        _lock?.Dispose();
        _lock = folderLock;
        if (folderLock is not null)
        {
            folderLock.Requested += (_, _) => Requested?.Invoke(this, EventArgs.Empty);
        }
    }

    private void StartFollowing(string shellFile)
    {
        _shellFile = shellFile;
        string? directory = Path.GetDirectoryName(shellFile);
        if (directory is null || !Directory.Exists(directory))
        {
            return;
        }

        // The shell may save by replacing the file, so a rename counts as a change too.
        _shellWatcher = new FileSystemWatcher(directory, Path.GetFileName(shellFile))
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName,
        };
        _shellWatcher.Changed += (_, _) => CopyShellFolder();
        _shellWatcher.Created += (_, _) => CopyShellFolder();
        _shellWatcher.Renamed += (_, _) => CopyShellFolder();
        _shellWatcher.EnableRaisingEvents = true;
        CopyShellFolder();
    }

    // Deleting the shell's file also stops the shell from writing it.
    private void StopFollowing()
    {
        lock (_gate)
        {
            _shellWatcher?.Dispose();
            _shellWatcher = null;
            if (_shellFile is not null)
            {
                DeleteFile(_shellFile);
                _shellFile = null;
            }
        }
    }

    private void CopyShellFolder()
    {
        lock (_gate)
        {
            if (_shellFile is null)
            {
                return;
            }

            try
            {
                string folder = File.ReadAllText(_shellFile).Trim();
                if (folder.Length > 0)
                {
                    WriteFollowFile(folder);
                }
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                // The shell is writing it. Its next change copies it again.
            }
        }
    }

    // Replaces the file whole, so the server never reads half of a folder's path. The server reads the file on every
    // request, so the file may be open for a moment; try a few times before giving up.
    private void WriteFollowFile(string folder)
    {
        string temporaryPath = $"{FollowFile}.tmp";
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                File.WriteAllText(temporaryPath, folder);
                File.Move(temporaryPath, FollowFile, overwrite: true);
                return;
            }
            catch (Exception exception) when ((exception is IOException or UnauthorizedAccessException) && attempt < 5)
            {
                Thread.Sleep(20);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                // The server keeps showing the last repository.
                return;
            }
        }
    }

    private static void DeleteFile(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // It's only a temporary file.
        }
    }
}

internal enum FolderSwitch
{
    Switched,
    NotRepository,
    AlreadyShown,
    ShownInAnotherWindow,
}
