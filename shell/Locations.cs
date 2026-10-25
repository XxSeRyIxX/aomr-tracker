// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

using System.Runtime.Versioning;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace AoMRTracker;

internal enum Platform { Windows, Linux, MacOS }

/// <summary>
/// The Steam client: where it is, its library folders and who signs in. On Windows, where the registry says. On Linux,
/// the native, Flatpak and Snap folders. Anywhere but Windows, also the Windows Steam of Wine bottles (CrossOver and
/// Whisky on macOS; Bottles, Lutris and ~/.wine on Linux), which is how the game runs on a Mac.
/// </summary>
internal static partial class Steam
{
    /// <summary>SteamID64 = this + the 32-bit account id.</summary>
    internal const ulong IdBase = 76561197960265728;
    public const string AppId = "1934680";

    public static Platform Current => OperatingSystem.IsWindows() ? Platform.Windows : OperatingSystem.IsMacOS() ? Platform.MacOS : Platform.Linux;

    public static string Home => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    public static IReadOnlyList<string> Roots() => [.. Roots(Current, Home, OperatingSystem.IsWindows() ? RegistryRoot() : null)];

    internal static IEnumerable<string> Roots(Platform platform, string home, string? registryRoot)
    {
        List<string> candidates = platform switch
        {
            Platform.Windows => [registryRoot ?? "", @"C:\Program Files (x86)\Steam"],
            Platform.Linux =>
            [
                Path.Combine(home, ".steam", "steam"),
                Path.Combine(home, ".local", "share", "Steam"),
                Path.Combine(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
                Path.Combine(home, "snap", "steam", "common", ".local", "share", "Steam"),
            ],
            _ => [],
        };
        candidates.AddRange(Bottles(platform, home).Select(bottle => Path.Combine(bottle, "drive_c", "Program Files (x86)", "Steam")));
        return candidates.Where(path => path.Length > 0 && Directory.Exists(path)).Select(Real).Distinct(Paths.Comparer);
    }

    /// <summary>The Wine bottles (prefixes) Windows programs may run in: each holds a drive_c folder.</summary>
    internal static IEnumerable<string> Bottles(Platform platform, string home)
    {
        string[] parents = platform switch
        {
            Platform.MacOS =>
            [
                Path.Combine(home, "Library", "Application Support", "CrossOver", "Bottles"),
                Path.Combine(home, "Library", "Containers", "com.isaacmarovitz.Whisky", "Bottles"),
            ],
            Platform.Linux =>
            [
                Path.Combine(home, ".local", "share", "bottles", "bottles"),
                Path.Combine(home, ".var", "app", "com.usebottles.bottles", "data", "bottles", "bottles"),
                Path.Combine(home, "Games"),
            ],
            _ => [],
        };
        foreach (string parent in parents)
            foreach (string bottle in Paths.Directories(parent))
                if (Directory.Exists(Path.Combine(bottle, "drive_c"))) yield return bottle;
        if (platform == Platform.Linux && Directory.Exists(Path.Combine(home, ".wine", "drive_c"))) yield return Path.Combine(home, ".wine");
    }

    [SupportedOSPlatform("windows")]
    private static string? RegistryRoot() => Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", null) as string;

    /// <summary>The library folders of a Steam folder, itself first.</summary>
    public static IEnumerable<string> Libraries(string root) => Libraries(root, Current);

    internal static IEnumerable<string> Libraries(string root, Platform platform)
    {
        yield return root;
        if (ReadText(Path.Combine(root, "steamapps", "libraryfolders.vdf")) is not { } folders) yield break;
        foreach (Match m in LibraryPath().Matches(folders))
            if (InBottle(Unescape(m.Groups[1].Value), root, platform) is { } library) yield return library;
    }

    /// <summary>
    /// A path as Steam wrote it. The Windows Steam of a Wine bottle writes Windows paths, such as D:\Games, which are
    /// the bottle's dosdevices\d: folder outside Windows. Null when a Windows path belongs to no bottle.
    /// </summary>
    internal static string? InBottle(string path, string root, Platform platform)
    {
        if (platform == Platform.Windows || !WindowsPath().IsMatch(path)) return path;
        string marker = $"{Path.DirectorySeparatorChar}drive_c{Path.DirectorySeparatorChar}";
        int at = root.IndexOf(marker, StringComparison.Ordinal);
        if (at < 0) return null;
        string[] parts = path[3..].Split(['\\', '/'], StringSplitOptions.RemoveEmptyEntries);
        return Path.Combine([root[..at], "dosdevices", $"{char.ToLowerInvariant(path[0])}:", .. parts]);
    }

    public static string SchemaFile(string root) => Path.Combine(root, "appcache", "stats", $"UserGameStatsSchema_{AppId}.bin");

    public static string UserFile(string root, string steamId) => Path.Combine(root, "appcache", "stats", $"UserGameStats_{AccountId(steamId)}_{AppId}.bin");

    /// <summary>The account signed in to Steam now, else the last one that was.</summary>
    public static string? CurrentAccount(IEnumerable<string> roots)
    {
        if (OperatingSystem.IsWindows() && ActiveUser() is int active and > 0) return (IdBase + (uint)active).ToString();
        foreach (string root in roots)
        {
            if (ReadText(Path.Combine(root, "config", "loginusers.vdf")) is not { } users) continue;
            foreach (Match user in LoginUser().Matches(users))
                if (VdfValue(user.Groups[2].Value, "MostRecent") == "1") return user.Groups[1].Value;
        }
        return null;
    }

    [SupportedOSPlatform("windows")]
    private static int? ActiveUser() => Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam\ActiveProcess", "ActiveUser", 0) as int?;

    /// <summary>The Steam name of an account that signed in on this computer.</summary>
    public static string? Persona(IEnumerable<string> roots, string steamId)
    {
        foreach (string root in roots)
        {
            if (ReadText(Path.Combine(root, "config", "loginusers.vdf")) is not { } users) continue;
            foreach (Match user in LoginUser().Matches(users))
                if (user.Groups[1].Value == steamId) return VdfValue(user.Groups[2].Value, "PersonaName");
        }
        return null;
    }

    public static uint AccountId(string steamId) => (uint)(ulong.Parse(steamId) - IdBase);

    /// <summary>A SteamID64: 17 digits. It names files, so nothing else may pass.</summary>
    public static bool IsSteamId(string? id) => id is { Length: 17 } && id.All(char.IsAsciiDigit) && ulong.TryParse(id, out ulong v) && v > IdBase;

    internal static string? VdfValue(string block, string key)
    {
        Match m = Regex.Match(block, $"\"{Regex.Escape(key)}\"\\s*\"((?:[^\"\\\\]|\\\\.)*)\"", RegexOptions.IgnoreCase);
        return m.Success ? Unescape(m.Groups[1].Value) : null;
    }

    private static string Unescape(string text) => text.Replace("\\\\", "\\").Replace("\\\"", "\"");

    internal static string? ReadText(string path)
    {
        try
        {
            return File.Exists(path) ? Encoding.UTF8.GetString(Files.ReadShared(path)) : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>A folder with its links followed, so ~/.steam/steam and ~/.local/share/Steam count once.</summary>
    private static string Real(string path)
    {
        try
        {
            return Path.TrimEndingDirectorySeparator(new DirectoryInfo(path).ResolveLinkTarget(returnFinalTarget: true)?.FullName ?? Path.GetFullPath(path));
        }
        catch (IOException)
        {
            return Path.GetFullPath(path);
        }
    }

    [GeneratedRegex("\"(\\d{17})\"\\s*\\{([^{}]*)\\}")]
    internal static partial Regex LoginUser();

    [GeneratedRegex("\"path\"\\s*\"((?:[^\"\\\\]|\\\\.)*)\"")]
    private static partial Regex LibraryPath();

    [GeneratedRegex(@"^[A-Za-z]:[\\/]")]
    private static partial Regex WindowsPath();
}

/// <summary>Age of Mythology: Retold as Steam installed it: its folder, Steam's language for it and the build.</summary>
internal sealed record GameInstall(string Dir, string Language, string? Build)
{
    public static GameInstall? Find() => Find(Steam.Roots(), Steam.Current);

    internal static GameInstall? Find(IEnumerable<string> roots, Platform platform)
    {
        foreach (string root in roots)
        {
            foreach (string library in Steam.Libraries(root, platform))
            {
                if (Steam.ReadText(Path.Combine(library, "steamapps", $"appmanifest_{Steam.AppId}.acf")) is not { } manifest) continue;
                string? folder = Steam.VdfValue(manifest, "installdir");
                if (string.IsNullOrEmpty(folder)) continue;
                string dir = Path.Combine(library, "steamapps", "common", folder);
                if (File.Exists(Path.Combine(dir, "game", "data", "Data.bar")))
                    return new GameInstall(dir, Steam.VdfValue(manifest, "language") is { Length: > 0 } language ? language : "english", Steam.VdfValue(manifest, "buildid"));
            }
        }
        return null;
    }

    /// <summary>The folder of a language under game\data\strings in Data.bar: Spanish for "es" (Mexican Spanish when
    /// the game is set to Latin American), else English.</summary>
    public static string StringsFolder(string lang, string steamLanguage) =>
        lang == "es" ? (steamLanguage == "latam" ? "SpanishMexican" : "Spanish") : "English";
}

/// <summary>The files of the player who played last: their id, the game's cache files and statistics.</summary>
internal sealed record PlayerFiles(string? Folder, string? PlayerId, string? Cache, string? Stats, string? Items, string? Challenges, string? AchievementIds)
{
    public static readonly PlayerFiles None = new(null, null, null, null, null, null, null);
}

/// <summary>
/// The game's own folder, "Age of Mythology Retold" in the Games folder of the user: on Windows the user's own; on Linux
/// and the Steam Deck, the one inside the game's Proton prefix; in a Wine bottle, the bottle's. It holds one folder per
/// player with the statistics (users\lcs.dat) and the game's cache of what its servers said (temp\RLink).
/// </summary>
internal static partial class GameFolders
{
    public const string Name = "Age of Mythology Retold";

    internal static IEnumerable<string> Candidates(Platform platform, string home, IEnumerable<string> roots)
    {
        if (platform == Platform.Windows) yield return Path.Combine(home, "Games", Name);
        foreach (string root in roots)
            foreach (string library in Steam.Libraries(root, platform))
                yield return Path.Combine(library, "steamapps", "compatdata", Steam.AppId, "pfx", "drive_c", "users", "steamuser", "Games", Name);
        foreach (string bottle in Steam.Bottles(platform, home))
            foreach (string user in Paths.Directories(Path.Combine(bottle, "drive_c", "users")))
                yield return Path.Combine(user, "Games", Name);
    }

    /// <summary>The folder the player chose, else the one the game saved to last.</summary>
    public static string? Find(string? chosen, IEnumerable<string> roots) => Find(chosen, Steam.Current, Steam.Home, roots);

    internal static string? Find(string? chosen, Platform platform, string home, IEnumerable<string> roots)
    {
        if (chosen is not null && Directory.Exists(chosen)) return chosen;
        return Candidates(platform, home, roots).Where(Directory.Exists).Distinct(Paths.Comparer)
            .Select(folder => (folder, saved: LastSaved(folder))).Where(f => f.saved > DateTime.MinValue)
            .OrderByDescending(f => f.saved).Select(f => f.folder).FirstOrDefault();
    }

    /// <summary>The game's folder from one the player chose: itself, the Games folder above it, or one inside it.</summary>
    public static string Normalize(string chosen)
    {
        string full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(chosen));
        if (Directory.Exists(Path.Combine(full, Name))) return Path.Combine(full, Name);
        for (DirectoryInfo? dir = new(full); dir is not null; dir = dir.Parent)
            if (dir.Name.Equals(Name, StringComparison.OrdinalIgnoreCase)) return dir.FullName;
        return full;
    }

    /// <summary>When the game last wrote the player's statistics or cache in a folder; MinValue when it never did.</summary>
    public static DateTime LastSaved(string folder)
    {
        PlayerFiles files = Files(folder);
        return new[] { files.Cache, files.Stats }.Where(f => f is not null).Select(f => File.GetLastWriteTimeUtc(f!)).DefaultIfEmpty(DateTime.MinValue).Max();
    }

    /// <summary>The newest of each cache file in temp\RLink, and the statistics of the player whose cache is newest.</summary>
    public static PlayerFiles Files(string? folder)
    {
        if (folder is null || !Directory.Exists(folder)) return PlayerFiles.None;
        string[] cached = Paths.Files(Path.Combine(folder, "temp", "RLink"));
        string? cache = Newest(cached, PlayerCache());
        string? playerId = cache is null ? null : PlayerCache().Match(Path.GetFileName(cache)).Groups[1].Value;
        string? stats = playerId is { Length: > 0 } && File.Exists(Path.Combine(folder, playerId, "users", "lcs.dat"))
            ? Path.Combine(folder, playerId, "users", "lcs.dat")
            : Paths.Directories(folder).Select(dir => Path.Combine(dir, "users", "lcs.dat")).Where(File.Exists).MaxBy(File.GetLastWriteTimeUtc);
        if (string.IsNullOrEmpty(playerId) && stats is not null) playerId = Path.GetFileName(Path.GetDirectoryName(Path.GetDirectoryName(stats)));
        return new PlayerFiles(folder, string.IsNullOrEmpty(playerId) ? null : playerId, cache, stats,
            Newest(cached, ItemsCache()), Newest(cached, ChallengesCache()), Newest(cached, AchievementsCache()));
    }

    /// <summary>The file of the newest game build ("-release21.dat" beats "-release9.dat"), then the newest written.</summary>
    internal static string? Newest(IEnumerable<string> files, Regex name) => files
        .Where(file => name.IsMatch(Path.GetFileName(file)))
        .OrderByDescending(file => Release().Match(Path.GetFileName(file)) is { Success: true } m ? int.Parse(m.Groups[1].ValueSpan) : -1)
        .ThenByDescending(File.GetLastWriteTimeUtc)
        .FirstOrDefault();

    [GeneratedRegex(@"^(\w*?)item-athens-[\w.-]+\.dat$", RegexOptions.IgnoreCase)]
    internal static partial Regex PlayerCache();

    [GeneratedRegex(@"^ItemCategoryCache-athens-[\w.-]+\.dat$", RegexOptions.IgnoreCase)]
    private static partial Regex ItemsCache();

    [GeneratedRegex(@"^ChallengeGetChallengesCache-athens-[\w.-]+\.dat$", RegexOptions.IgnoreCase)]
    private static partial Regex ChallengesCache();

    [GeneratedRegex(@"^GetAvailableAchievementsCache-athens-[\w.-]+\.dat$", RegexOptions.IgnoreCase)]
    private static partial Regex AchievementsCache();

    [GeneratedRegex(@"release(\d{1,6})", RegexOptions.IgnoreCase)]
    private static partial Regex Release();
}

/// <summary>Folder listings that never throw: a folder that is missing or can't be read lists nothing.</summary>
internal static class Paths
{
    public static readonly StringComparer Comparer = OperatingSystem.IsWindows() || OperatingSystem.IsMacOS() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

    public static string[] Directories(string folder) => List(() => Directory.GetDirectories(folder));

    public static string[] Files(string folder) => List(() => Directory.GetFiles(folder));

    private static string[] List(Func<string[]> list)
    {
        try
        {
            return list();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }
}
