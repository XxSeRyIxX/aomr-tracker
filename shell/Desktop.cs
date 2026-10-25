// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

using System.ComponentModel;
using System.Diagnostics;

namespace AoMRTracker;

/// <summary>What a page can't do inside the webview: open links in the user's own browser.</summary>
internal static class Desktop
{
    /// <summary>Opens a web link in the user's browser.</summary>
    public static void Open(string url)
    {
        Uri link = SafeLink(url) ?? throw new ApiException(400, "bad-link", "The tracker only opens web links.");
        try
        {
            Process.Start(new ProcessStartInfo(link.AbsoluteUri) { UseShellExecute = true })?.Dispose();
        }
        catch (Win32Exception e)
        {
            throw new ApiException(500, "no-browser", $"Couldn't open your browser: {e.Message}");
        }
    }

    /// <summary>Web links only: any other scheme could start a program on this computer.</summary>
    internal static Uri? SafeLink(string? url) =>
        url is { Length: > 0 and <= 4096 } && !url.Any(char.IsControl)
        && Uri.TryCreate(url, UriKind.Absolute, out Uri? uri) && uri.Scheme is "https" or "http" ? uri : null;
}
