// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

namespace AoMRTracker;

/// <summary>Where the player's files are this time: the game's folder, its cache and statistics, and Steam's files.</summary>
internal sealed record Located(string? Folder, PlayerFiles Player, string? SteamId, string? SteamUser, string? SteamSchema)
{
    public static readonly Located None = new(null, PlayerFiles.None, null, null, null);

    /// <summary>The file behind a /local/ name. Null for anything else, so no request can name another file.</summary>
    public string? Path(string name) => name switch
    {
        "cache" => Player.Cache,
        "stats" => Player.Stats,
        "items" => Player.Items,
        "challenges" => Player.Challenges,
        "achievement-ids" => Player.AchievementIds,
        "steam-user" => SteamUser,
        "steam-schema" => SteamSchema,
        _ => null,
    };
}

/// <summary>Finds the player's files, the game's texts and art, and reads the public data online.</summary>
internal sealed class Tracker(Store store, RelicLink relic)
{
    private readonly SemaphoreSlim _online = new(1, 1);
    private volatile Located _found = Located.None;
    private volatile GameInstall? _install;

    /// <summary>The game's install folder, as the last load found it, for its art.</summary>
    public string? GameDir => _install?.Dir;

    /// <summary>Where a folder dialog starts: the game's folder when known.</summary>
    public string StartFolder => _found.Folder ?? Steam.Home;

    /// <summary>What is on this computer, the game's texts in "en" or "es" ("auto": the game's language), and the online data saved last time.</summary>
    public Snapshot Load(string lang)
    {
        if (lang is not ("en" or "es" or "auto")) throw new ApiException(400, "bad-request", "Unknown language.");
        IReadOnlyList<string> roots = Steam.Roots();
        GameInstall? install = _install = GameInstall.Find(roots, Steam.Current);
        string steamLanguage = install?.Language ?? "english";
        if (lang == "auto") lang = steamLanguage is "spanish" or "latam" ? "es" : "en";

        Dictionary<string, string> strings = [];
        if (install is not null)
        {
            try
            {
                strings = StringTables.Load(install.Dir, GameInstall.StringsFolder(lang, steamLanguage));
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException) { }
        }

        Located found = Locate(roots);
        return new Snapshot(
            Steam.Current switch { Platform.Windows => "windows", Platform.MacOS => "mac", _ => "linux" },
            new PlayerInfo(found.Player.PlayerId ?? found.SteamId, found.SteamId is null ? null : Steam.Persona(roots, found.SteamId)),
            new GameInfo(install is not null, steamLanguage, install is not null && File.Exists(GameArt.Archive(install.Dir))),
            found.Folder, StampOf(found), strings, store.ReadOnline());
    }

    /// <summary>When the player's files were last written, for the page's polling.</summary>
    public Stamp Stamp() => StampOf(Locate(Steam.Roots()));

    public string? LocalFile(string name) => _found.Path(name);

    /// <summary>
    /// The game's folder: the chosen one, else the newest of the usual places. The player is whoever the game's cache
    /// is newest for; their Steam files go with them, and without the game's files, Steam's current account.
    /// </summary>
    private Located Locate(IReadOnlyList<string> roots)
    {
        string? folder = GameFolders.Find(store.ReadSettings().GameFolder, roots);
        PlayerFiles player = GameFolders.Files(folder);
        string? steamId = Steam.IsSteamId(player.PlayerId) ? player.PlayerId : player.PlayerId is null ? Steam.CurrentAccount(roots) : null;
        string? steamUser = steamId is null ? null : roots.Select(root => Steam.UserFile(root, steamId)).FirstOrDefault(File.Exists);
        string? schema = roots.Select(Steam.SchemaFile).FirstOrDefault(File.Exists);
        return _found = new Located(folder, player, steamId, steamUser, schema);
    }

    private static Stamp StampOf(Located f) => new(
        Files.UnixMs(f.Player.Cache), Files.UnixMs(f.Player.Stats), Files.UnixMs(f.SteamUser), Files.UnixMs(f.SteamSchema),
        Files.UnixMs(f.Player.Items), Files.UnixMs(f.Player.Challenges), Files.UnixMs(f.Player.AchievementIds));

    /// <summary>Remembers the game's folder the player chose, when it holds the game's files.</summary>
    public bool Choose(string chosen)
    {
        string folder = GameFolders.Normalize(chosen);
        if (GameFolders.LastSaved(folder) == DateTime.MinValue)
            throw new ApiException(400, "not-game-folder", "That folder doesn't hold the game's files.");
        store.WriteSettings(store.ReadSettings() with { GameFolder = folder });
        Locate(Steam.Roots());
        return true;
    }

    /// <summary>
    /// The public data of the game servers: badge, challenge and achievement lists, Steam's rarity, and the player's
    /// items and achievements, for the profile the game's cache names, else the one of the Steam account.
    /// </summary>
    public async Task<OnlineData> RefreshAsync(long? profileId, CancellationToken ct)
    {
        await _online.WaitAsync(ct);
        try
        {
            OnlineData saved = store.ReadOnline() ?? new OnlineData();
            string? alias = null;
            if (profileId is null && _found.SteamId is { } steamId && await relic.FindProfileAsync(steamId, null, ct) is var (id, name, _))
                (profileId, alias) = (id, name);

            List<ItemDef> items = await relic.ItemDefinitionsAsync(ct);
            var (groups, challenges) = await relic.ChallengesAsync(ct);
            Dictionary<long, string> ids = await relic.AchievementIdsAsync(ct);
            Dictionary<string, double>? rarity = saved.Rarity;
            try
            {
                rarity = await relic.RarityAsync(ct);
            }
            catch (Exception e) when (e is HttpRequestException or System.Text.Json.JsonException or KeyNotFoundException or InvalidOperationException or ApiException) { }

            Dictionary<int, long>? earned = null;
            Dictionary<long, long>? achievements = null;
            if (profileId is long profile)
            {
                earned = await relic.InventoryAsync(profile, ct);
                achievements = await relic.AchievementsAsync(profile, ct);
            }
            OnlineData data = new(profileId, alias ?? (profileId == saved.ProfileId ? saved.Alias : null), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                earned, achievements, items, groups, challenges, ids, rarity);
            store.WriteOnline(data);
            return data;
        }
        finally
        {
            _online.Release();
        }
    }

    /// <summary>
    /// A player's public profile, for players whose game isn't on this computer: found by in-game name or Steam ID,
    /// or by its id once found. Who they are, their badges and titles, and their achievements.
    /// </summary>
    public async Task<PublicProfile> ProfileAsync(string? name, long? id, CancellationToken ct)
    {
        name = name?.Trim();
        if (id is null && (string.IsNullOrEmpty(name) || name.Length > 100)) throw new ApiException(400, "bad-request", "Bad request.");
        var (profileId, alias, account) = await relic.FindProfileAsync(name, id, ct)
            ?? throw new ApiException(404, "no-player", "No player with that name. Check how it is written in the game: capitals count.");
        return new PublicProfile(profileId, alias, account, await relic.InventoryAsync(profileId, ct), await relic.AchievementsAsync(profileId, ct));
    }
}
