// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

using System.Reflection;
using System.Text.RegularExpressions;

namespace AoMRTracker;

/// <summary>
/// The web app (app/), embedded in the executable, at http://127.0.0.1:5190/, plus what only the desktop can reach:
/// /media/badge/name.png and /media/achievement/name.png, art from the game's files, and /local/name, the player's own
/// files (see Located.Path).
/// </summary>
internal static partial class Site
{
    /// <summary>The page keeps its settings per origin, so the address never changes.</summary>
    internal const int Port = 5190;
    internal const string Origin = "http://127.0.0.1:5190";
    private const string Prefix = "site.";

    /// <summary>The player's file behind a /local/ name, or null.</summary>
    internal static Func<string, string?> LocalFiles { get; set; } = _ => null;

    /// <summary>The game's install folder, for its art.</summary>
    internal static Func<string?> GameDir { get; set; } = () => null;

    private static readonly Assembly Assembly = typeof(Site).Assembly;

    // RecursiveDir leaves Windows separators in the resource name; the URLs that ask for them always use the other kind.
    private static readonly Dictionary<string, string> Files = Assembly.GetManifestResourceNames()
        .Where(n => n.StartsWith(Prefix, StringComparison.Ordinal))
        .ToDictionary(n => n[Prefix.Length..].Replace('\\', '/'), n => n);

    /// <summary>The file for a request target such as "/app.js?v=1", or null. Exact names only, so "../" can't escape.</summary>
    internal static (Stream Content, string Type)? Open(string target)
    {
        string name = Uri.UnescapeDataString(target.Split('?', 2)[0].Split('#', 2)[0]).TrimStart('/');
        if (name.Length == 0) name = "index.html";
        if (name.StartsWith("media/", StringComparison.Ordinal)) return Media(name["media/".Length..]);
        if (name.StartsWith("local/", StringComparison.Ordinal)) return Local(name["local/".Length..]);
        return Files.TryGetValue(name, out string? resource) && Assembly.GetManifestResourceStream(resource) is { } content
            ? (content, ContentType(name))
            : null;
    }

    /// <summary>badge/name.png or achievement/name.png. Names are checked against a pattern before any file is touched.</summary>
    private static (Stream Content, string Type)? Media(string name)
    {
        try
        {
            Match art = ArtName().Match(name);
            string folder = art.Groups[1].Value == "badge" ? GameArt.Badges : GameArt.Achievements;
            if (art.Success && GameDir() is { } dir && GameArt.Png(dir, folder, art.Groups[2].Value) is { } png)
                return (new MemoryStream(png), "image/png");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException) { }
        return null;
    }

    /// <summary>One of the player's files, as it is on disk: the page decodes it.</summary>
    private static (Stream Content, string Type)? Local(string name)
    {
        try
        {
            if (LocalFiles(name) is { } path && File.Exists(path))
                return (new MemoryStream(AoMRTracker.Files.ReadShared(path)), "application/octet-stream");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        return null;
    }

    private static string ContentType(string name) => Path.GetExtension(name) switch
    {
        ".html" => "text/html; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".json" => "application/json",
        ".png" => "image/png",
        ".svg" => "image/svg+xml",
        ".webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    };

    [GeneratedRegex("^(badge|achievement)/([a-z0-9_]{1,64})\\.png$")]
    private static partial Regex ArtName();
}
