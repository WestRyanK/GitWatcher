using System.ComponentModel;
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;

namespace GitWatcher.Overlay;

/// <summary>
/// Runs Git Watcher's Node server (GitWatcher/server.js) for one repository, on a free port, for as
/// long as the overlay is open.
/// </summary>
internal sealed class GitWatcherServer : IDisposable
{
    private static readonly TimeSpan StartupTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan StartupPollInterval = TimeSpan.FromMilliseconds(150);

    private readonly Process _process;
    private readonly StringBuilder _output = new();

    private GitWatcherServer(Process process, Uri address)
    {
        _process = process;
        Address = address;
    }

    public Uri Address { get; }

    public static async Task<GitWatcherServer> StartAsync(string serverScript, string repositoryPath)
    {
        int port = FindFreePort();
        ProcessStartInfo startInfo = new("node")
        {
            WorkingDirectory = repositoryPath,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        startInfo.ArgumentList.Add(serverScript);
        startInfo.ArgumentList.Add(repositoryPath);
        startInfo.Environment["PORT"] = port.ToString();

        // The server exits by itself if this process goes away without stopping it, for example after a crash.
        startInfo.Environment["GIT_WATCHER_PARENT_PID"] = Environment.ProcessId.ToString();

        Process process;
        try
        {
            process = Process.Start(startInfo) ?? throw new InvalidOperationException("Node.js didn't start.");
        }
        catch (Win32Exception exception)
        {
            throw new InvalidOperationException("Couldn't start Node.js. Install it and make sure 'node' is on PATH.", exception);
        }

        // The server listens on 127.0.0.1 only.
        GitWatcherServer server = new(process, new Uri($"http://127.0.0.1:{port}/"));
        process.OutputDataReceived += server.OnOutput;
        process.ErrorDataReceived += server.OnOutput;
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        try
        {
            await server.WaitUntilReadyAsync();
        }
        catch
        {
            server.Dispose();
            throw;
        }

        return server;
    }

    public void Dispose()
    {
        try
        {
            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
            }
        }
        catch (InvalidOperationException)
        {
            // The process already exited.
        }

        _process.Dispose();
    }

    private static int FindFreePort()
    {
        TcpListener listener = new(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            return ((IPEndPoint)listener.LocalEndpoint).Port;
        }
        finally
        {
            listener.Stop();
        }
    }

    private async Task WaitUntilReadyAsync()
    {
        using HttpClient client = new() { Timeout = TimeSpan.FromSeconds(2) };
        Uri versionAddress = new(Address, "api/version");
        Stopwatch stopwatch = Stopwatch.StartNew();
        while (stopwatch.Elapsed < StartupTimeout)
        {
            if (_process.HasExited)
            {
                throw new InvalidOperationException($"The Git Watcher server stopped while starting.\n{GetOutput()}");
            }

            try
            {
                using HttpResponseMessage response = await client.GetAsync(versionAddress);
                if (response.IsSuccessStatusCode)
                {
                    return;
                }
            }
            catch (HttpRequestException)
            {
                // Not listening yet.
            }
            catch (TaskCanceledException)
            {
                // The request timed out; try again.
            }

            await Task.Delay(StartupPollInterval);
        }

        throw new TimeoutException($"The Git Watcher server didn't start within {StartupTimeout.TotalSeconds} seconds.\n{GetOutput()}");
    }

    private void OnOutput(object sender, DataReceivedEventArgs e)
    {
        if (e.Data is null)
        {
            return;
        }

        lock (_output)
        {
            _output.AppendLine(e.Data);
        }
    }

    private string GetOutput()
    {
        lock (_output)
        {
            return _output.ToString().Trim();
        }
    }
}
