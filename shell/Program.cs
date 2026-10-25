// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

using System.Collections.Concurrent;
using System.Drawing;
using System.Net.Sockets;
using System.Runtime.Versioning;
using System.Text.Json;
using Microsoft.Win32;
using Photino.NET;

namespace AoMRTracker;

/// <summary>
/// The desktop app, for Windows, macOS and Linux: the web app from app/ in the system's own webview (Photino), plus what
/// a page can't do: find and read the game's folder and Steam's files, ask the game's servers for public data and open
/// links outside. The page asks for those through the window's messages (app/native.js), which no other program or
/// website can reach.
/// </summary>
internal static class Program
{
    private static readonly ConcurrentDictionary<string, CancellationTokenSource> Running = new();

    [STAThread]
    private static int Main(string[] args)
    {
        using Mutex instance = new(false, "AoMRTracker");
        try
        {
            if (!instance.WaitOne(0)) return 0;
        }
        catch (AbandonedMutexException) { }

        try
        {
            RunWindow(args);
        }
        finally
        {
            instance.ReleaseMutex();
        }
        return 0;
    }

    private static void RunWindow(string[] args)
    {
        string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create), "AoMRTracker");
        // The page's own background while WebView2 starts, instead of a white window.
        if (OperatingSystem.IsWindows()) Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", LightTheme() ? "FFF4EFE4" : "FF0C1120");

        PhotinoWindow window = new PhotinoWindow()
            // First: Photino logs every call and message unless told not to.
            .SetLogVerbosity(0)
            .SetTitle("AoM Retold Tracker")
            .SetUseOsDefaultSize(false)
            .SetSize(1360, 900)
            .SetMinSize(520, 560)
            .Center()
            .SetDevToolsEnabled(args.Contains("--dev"))
            // The app needs no camera, microphone or other permission: never grant one without asking.
            .SetGrantBrowserPermissions(false)
            .SetMediaStreamEnabled(false);
        // Its own WebView2 profile, instead of the one every Photino app shares.
        if (OperatingSystem.IsWindows()) window.SetTemporaryFilesPath(Path.Combine(data, "WebView2"));
        window.RegisterWindowCreatedHandler((_, _) => FitToScreen(window));

        using RelicLink relic = new();
        Tracker tracker = new(new Store(data), relic);
        Site.LocalFiles = tracker.LocalFile;
        Site.GameDir = () => tracker.GameDir;
        Commands commands = new(tracker, (title, start) => PickFolder(window, title, start));
        window.RegisterWebMessageReceivedHandler((_, message) => OnMessage(window, commands, message));

        SiteServer? server = null;
        if (OperatingSystem.IsWindows())
        {
            // Requests for http://127.0.0.1:5190 are answered from memory: no socket for security software to break.
            window.RegisterCustomSchemeHandler("http", ServeEmbedded);
        }
        else
        {
            try
            {
                server = new SiteServer(Site.Port);
            }
            catch (SocketException)
            {
                window.LoadRawString(PortTaken);
                window.WaitForClose();
                return;
            }
        }
        using (server)
        {
            window.Load(new Uri(Site.Origin + "/"));
            window.WaitForClose();
        }
    }

    private const string PortTaken = """
        <!doctype html>
        <html lang="en">
        <meta charset="utf-8">
        <title>AoM Retold Tracker</title>
        <body style="font:16px/1.5 system-ui;max-width:40rem;margin:3rem auto;padding:0 1.5rem;color:#ece7da;background:#0c1120">
        <h1 style="font-size:1.4rem">AoM Retold Tracker</h1>
        <p>Port 5190 on this computer is in use, so the tracker can't show its page. Close the program that uses it, or
        another copy of the tracker, and open the tracker again.</p>
        </body>
        </html>
        """;

    /// <summary>Whether Windows apps are set to the light theme, as the page will then be.</summary>
    [SupportedOSPlatform("windows")]
    private static bool LightTheme() =>
        Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 0) is 1;

    /// <summary>1360 by 900, but at most 90% of the main screen, and centered.</summary>
    private static void FitToScreen(PhotinoWindow window)
    {
        var monitors = window.Monitors;
        if (monitors.Count == 0) return;
        var screen = monitors.FirstOrDefault(m => m.MonitorArea.Location == Point.Empty, monitors[0]);
        // Windows sizes windows in physical pixels; macOS and Linux in points.
        double scale = OperatingSystem.IsWindows() ? screen.Scale : 1;
        window.SetSize((int)Math.Min(1360 * scale, screen.WorkArea.Width * 0.9), (int)Math.Min(900 * scale, screen.WorkArea.Height * 0.9));
        window.Center();
    }

    /// <summary>The system's folder dialog, on the window's own thread.</summary>
    private static string? PickFolder(PhotinoWindow window, string title, string start)
    {
        string[]? picked = null;
        window.Invoke(() => picked = window.ShowOpenFolder(title, start, false));
        return picked is { Length: > 0 } && !string.IsNullOrEmpty(picked[0]) ? picked[0] : null;
    }

    /// <summary>The app's own files and the game's art; any other http:// request goes to the network as usual.</summary>
    private static Stream? ServeEmbedded(object sender, string scheme, string url, out string contentType)
    {
        contentType = "";
        if (!url.StartsWith(Site.Origin + "/", StringComparison.OrdinalIgnoreCase) || Site.Open(url[Site.Origin.Length..]) is not var (content, type))
            return null;
        contentType = type;
        return content;
    }

    /// <summary>Runs each request off the UI thread and answers with its id. "cancel" stops a running request.</summary>
    private static void OnMessage(PhotinoWindow window, Commands commands, string message)
    {
        Request? request;
        try
        {
            request = JsonSerializer.Deserialize(message, ShellJson.Default.Request);
        }
        catch (JsonException)
        {
            return;
        }
        if (request is null) return;

        if (request.Cmd == "cancel")
        {
            try
            {
                CancelRequest? cancel = request.Args.Deserialize(ShellJson.Default.CancelRequest);
                if (cancel is not null && Running.TryGetValue(cancel.Id, out CancellationTokenSource? running)) running.Cancel();
            }
            catch (Exception e) when (e is JsonException or InvalidOperationException or ObjectDisposedException) { }
            return;
        }
        _ = Task.Run(() => AnswerAsync(window, commands, request));
    }

    private static async Task AnswerAsync(PhotinoWindow window, Commands commands, Request request)
    {
        using CancellationTokenSource cancel = new();
        if (!Running.TryAdd(request.Id, cancel)) return;
        Reply reply;
        try
        {
            reply = new Reply(request.Id, true, await commands.RunAsync(request.Cmd, request.Args, cancel.Token));
        }
        catch (Exception e)
        {
            (int status, string code, string error) = Errors.Explain(e);
            reply = new Reply(request.Id, false, Status: status, Code: code, Error: error);
        }
        finally
        {
            Running.TryRemove(request.Id, out _);
        }
        window.SendWebMessage(JsonSerializer.Serialize(reply, ShellJson.Default.Reply));
    }
}
