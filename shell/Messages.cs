// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace AoMRTracker;

// What the page (app/native.js) and the shell send each other. The published app is trimmed, so JSON can't fall
// back to reflection: every type is listed in ShellJson below.

/// <summary>A request from the page. Args depend on the command.</summary>
public sealed record Request(string Id, string Cmd, JsonElement Args);

/// <summary>The answer to one request: Data when Ok, else an HTTP-like status, a code the page translates, and an
/// English message for anything without a translation.</summary>
public sealed record Reply(string Id, bool Ok, JsonNode? Data = null, int? Status = null, string? Code = null, string? Error = null);

public sealed record CancelRequest(string Id);
public sealed record OpenRequest(string Url);

/// <summary>The language of the game's texts: "en", "es", or "auto" for the game's own.</summary>
public sealed record LoadRequest(string Lang);

/// <summary>The player's profile on the game servers, when the game's cache names it.</summary>
public sealed record RefreshRequest(long? ProfileId = null);

/// <summary>A player to find on the game servers: by in-game name or Steam ID, or by profile id once found.</summary>
public sealed record ProfileRequest(string? Name = null, long? Id = null);

/// <summary>
/// A player's public profile: profile id, in-game name, account ("/steam/76561...", "/xboxlive/..."), items (item id
/// to Unix seconds) and achievements (achievement id to Unix seconds).
/// </summary>
public sealed record PublicProfile(long Id, string Alias, string Account, Dictionary<int, long> Earned, Dictionary<long, long> Unlocked);

/// <summary>The title of the folder dialog, in the page's language.</summary>
public sealed record ChooseRequest(string Title);

/// <summary>
/// What the desktop found: the system ("windows", "linux", "mac"), the player, the game's install, its folder, when each
/// of the player's files was written, the game's texts, and the online data saved by the last refresh. The page reads
/// the files itself from /local/ (see Site), with the code the website uses on files the player drops in.
/// </summary>
public sealed record Snapshot(string Os, PlayerInfo Player, GameInfo Game, string? Folder, Stamp Files, Dictionary<string, string> Strings, OnlineData? Online);

/// <summary>Id: the player whose files are shown (a SteamID64 for Steam). Persona: their Steam name, when Steam knows them.</summary>
public sealed record PlayerInfo(string? Id, string? Persona);

/// <summary>Language is Steam's language for the game ("english", "spanish", "latam"...). Images: the game's art was found.</summary>
public sealed record GameInfo(bool Installed, string Language, bool Images);

/// <summary>When (Unix ms, 0 if missing) each of the player's files was written. The page polls it and reads again what changed.</summary>
public sealed record Stamp(long Cache, long Stats, long SteamUser, long SteamSchema, long Items, long Challenges, long AchievementIds);

/// <summary>
/// What the game servers said on the last refresh, all of it public: the player's profile, items (item id to Unix
/// seconds) and achievements (achievement id to Unix seconds), the badge and title definitions, the badge challenges,
/// the achievements' names by id, and Steam's global unlock rates.
/// </summary>
public sealed record OnlineData(long? ProfileId = null, string? Alias = null, long? PublicAt = null,
    Dictionary<int, long>? Earned = null, Dictionary<long, long>? Achievements = null, List<ItemDef>? Items = null,
    JsonElement? Groups = null, JsonElement? Challenges = null, Dictionary<long, string>? AchievementIds = null,
    Dictionary<string, double>? Rarity = null);

/// <summary>A badge or title definition. Meta is the server's JSON text: tier, family, image and name string.</summary>
public sealed record ItemDef(int Id, string Name, int[] Categories, string Meta);

/// <summary>Kept in settings.json. GameFolder: the game's folder, when the player chose it.</summary>
public sealed record Settings(string? GameFolder = null);

// Missing or null values for non-nullable properties are refused, so a bad request fails here, not halfway through.
// Optional values need a default, or they count as required too.
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true,
    RespectNullableAnnotations = true, RespectRequiredConstructorParameters = true)]
[JsonSerializable(typeof(Request))]
[JsonSerializable(typeof(Reply))]
[JsonSerializable(typeof(CancelRequest))]
[JsonSerializable(typeof(OpenRequest))]
[JsonSerializable(typeof(LoadRequest))]
[JsonSerializable(typeof(RefreshRequest))]
[JsonSerializable(typeof(ProfileRequest))]
[JsonSerializable(typeof(PublicProfile))]
[JsonSerializable(typeof(ChooseRequest))]
[JsonSerializable(typeof(Snapshot))]
[JsonSerializable(typeof(Stamp))]
[JsonSerializable(typeof(OnlineData))]
[JsonSerializable(typeof(Settings))]
[JsonSerializable(typeof(bool))]
internal sealed partial class ShellJson : JsonSerializerContext;
