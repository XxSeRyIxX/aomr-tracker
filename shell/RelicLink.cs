// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

using System.Globalization;
using System.Net;
using System.Text.Json;

namespace AoMRTracker;

/// <summary>
/// The game's online service (Relic Link, run by World's Edge for the Age games), and Steam's global achievement
/// rates. Only public data, with no sign-in: profiles, items, achievements, badge definitions and challenges.
/// </summary>
internal sealed class RelicLink : IDisposable
{
    internal const string Api = "https://athens-live-api.worldsedgelink.com";
    private const string Title = "athens";
    private const int BadgeCategory = 1003, TitleCategory = 1004;

    internal static readonly string UserAgent = $"AoMRTracker/{typeof(RelicLink).Assembly.GetName().Version?.ToString(3)} (+https://github.com/XxSeRyIxX/aomr-tracker)";

    private readonly HttpClient _http = NewClient();

    public void Dispose() => _http.Dispose();

    private static HttpClient NewClient()
    {
        HttpClient http = new(new HttpClientHandler { UseCookies = false, AutomaticDecompression = DecompressionMethods.All }) { Timeout = TimeSpan.FromSeconds(30) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);
        return http;
    }

    /// <summary>
    /// A player, by in-game name (the servers match it exactly, capitals too), SteamID64 or profile id: their profile
    /// id, in-game name and account ("/steam/76561...", "/xboxlive/..."). Null when the servers know no such player.
    /// </summary>
    public async Task<(long Id, string Alias, string Account)?> FindProfileAsync(string? name, long? profileId, CancellationToken ct)
    {
        string query = profileId is long id ? $"profile_ids=[{id}]"
            : Steam.IsSteamId(name) ? $"profile_names={Uri.EscapeDataString($"[\"/steam/{name}\"]")}"
            : $"aliases={Uri.EscapeDataString($"[\"{JsonEncodedText.Encode(name ?? "")}\"]")}";
        using HttpResponseMessage response = await SendAsync($"{Api}/community/leaderboard/GetPersonalStat?title={Title}&{query}", ct);
        using JsonDocument doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        // No such player is an error code rather than an empty list: UNREGISTERED_PROFILE_NAME (3) or UNKNOWN_ALIASES (9).
        int code = ResultCode(doc.RootElement);
        if (code is 3 or 9) return null;
        if (code != 0) throw new ApiException(502, "server-error", $"The game servers answered with error {code}.");
        foreach (JsonElement group in Array(doc.RootElement, "statGroups"))
            foreach (JsonElement member in Array(group, "members"))
                return (member.GetProperty("profile_id").GetInt64(), Text(member, "alias"), Text(member, "name"));
        return null;
    }

    /// <summary>Item definition id to the earliest time (Unix seconds) the player got it.</summary>
    public async Task<Dictionary<int, long>> InventoryAsync(long profileId, CancellationToken ct)
    {
        using JsonDocument doc = await GetCommunityAsync($"item/getInventoryByProfileIDs?title={Title}&profileIDs=[{profileId}]", ct);
        Dictionary<int, long> owned = [];
        foreach (JsonElement item in ByProfile(doc.RootElement, "itemInstancesByProfileID"))
        {
            int id = item.GetProperty("itemdefinition_id").GetInt32();
            long at = item.TryGetProperty("creationdate", out JsonElement c) && c.TryGetInt64(out long t) ? t : 0;
            if (!owned.TryGetValue(id, out long known) || at < known) owned[id] = at;
        }
        return owned;
    }

    /// <summary>The achievements the game servers recorded for a profile: achievement id to Unix seconds.</summary>
    public async Task<Dictionary<long, long>> AchievementsAsync(long profileId, CancellationToken ct)
    {
        using JsonDocument doc = await GetCommunityAsync($"achievement/getAchievements?title={Title}&profileIDs=[{profileId}]", ct);
        Dictionary<long, long> unlocked = [];
        foreach (JsonElement a in ByProfile(doc.RootElement, "userAchievementsMap"))
            if (a.TryGetProperty("achievement_id", out JsonElement id) && id.TryGetInt64(out long key))
                unlocked[key] = a.TryGetProperty("achieveddate", out JsonElement at) && at.TryGetInt64(out long time) ? time : 0;
        return unlocked;
    }

    /// <summary>Every achievement's name, by the servers' id for it.</summary>
    public async Task<Dictionary<long, string>> AchievementIdsAsync(CancellationToken ct)
    {
        using JsonDocument doc = await GetCommunityAsync($"achievement/getAvailableAchievements?title={Title}", ct);
        Dictionary<long, string> names = [];
        foreach (JsonElement a in Array(doc.RootElement, "achievementDefs"))
            if (a.TryGetProperty("id", out JsonElement id) && id.TryGetInt64(out long key) && a.TryGetProperty("name", out JsonElement name) && name.GetString() is { } text)
                names[key] = text;
        return names;
    }

    /// <summary>The badge and title definitions.</summary>
    public async Task<List<ItemDef>> ItemDefinitionsAsync(CancellationToken ct)
    {
        using JsonDocument doc = await GetCommunityAsync($"item/getItemDefinitions?title={Title}", ct);
        List<ItemDef> items = [];
        foreach (JsonElement def in Array(doc.RootElement, "itemDefinitions"))
        {
            int[] categories = [.. Array(def, "categoryIDs").Where(c => c.ValueKind == JsonValueKind.Number).Select(c => c.GetInt32())];
            if (!categories.Contains(BadgeCategory) && !categories.Contains(TitleCategory)) continue;
            items.Add(new ItemDef(def.GetProperty("id").GetInt32(), def.GetProperty("name").GetString() ?? "", categories,
                def.TryGetProperty("metaData", out JsonElement meta) ? meta.GetString() ?? "" : ""));
        }
        return items;
    }

    /// <summary>The badge challenges and what each one asks for.</summary>
    public async Task<(JsonElement Groups, JsonElement Challenges)> ChallengesAsync(CancellationToken ct)
    {
        using HttpResponseMessage response = await SendAsync($"{Api}/game/Challenge/getChallenges?title={Title}", ct);
        using JsonDocument doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        JsonElement root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Array || root.GetArrayLength() < 3 || !root[0].TryGetInt32(out int code) || code != 0)
            throw new JsonException("Unexpected challenge list.");
        return (root[1].Clone(), root[2].Clone());
    }

    /// <summary>Steam's share of players with each achievement, in percent.</summary>
    public async Task<Dictionary<string, double>> RarityAsync(CancellationToken ct)
    {
        using HttpResponseMessage response = await SendAsync(
            $"https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid={Steam.AppId}", ct);
        using JsonDocument doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        Dictionary<string, double> rarity = [];
        if (doc.RootElement.TryGetProperty("achievementpercentages", out JsonElement block))
        {
            foreach (JsonElement a in Array(block, "achievements"))
            {
                JsonElement percent = a.GetProperty("percent");
                double value = percent.ValueKind == JsonValueKind.Number ? percent.GetDouble()
                    : double.TryParse(percent.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out double p) ? p : -1;
                if (a.GetProperty("name").GetString() is { } name && value >= 0) rarity[name] = value;
            }
        }
        return rarity;
    }

    private async Task<HttpResponseMessage> SendAsync(string url, CancellationToken ct)
    {
        HttpResponseMessage response = await _http.GetAsync(url, ct);
        if (response.StatusCode == HttpStatusCode.TooManyRequests)
        {
            response.Dispose();
            throw new ApiException(429, "busy", "The game servers ask to slow down. Try again in a minute.");
        }
        try
        {
            response.EnsureSuccessStatusCode();
        }
        catch
        {
            response.Dispose();
            throw;
        }
        return response;
    }

    /// <summary>Community answers carry {"result": {"code": 0}} when all went well.</summary>
    private async Task<JsonDocument> GetCommunityAsync(string path, CancellationToken ct)
    {
        using HttpResponseMessage response = await SendAsync($"{Api}/community/{path}", ct);
        JsonDocument doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        int code = ResultCode(doc.RootElement);
        if (code == 0) return doc;
        doc.Dispose();
        throw new ApiException(502, "server-error", $"The game servers answered with error {code}.");
    }

    private static int ResultCode(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty("result", out JsonElement result) && result.TryGetProperty("code", out JsonElement c) && c.TryGetInt32(out int rc) ? rc : -1;

    private static string Text(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";

    private static IEnumerable<JsonElement> Array(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object && parent.TryGetProperty(name, out JsonElement list) && list.ValueKind == JsonValueKind.Array
            ? list.EnumerateArray()
            : [];

    /// <summary>The entries of answers shaped [{ "profile id": [entries] }].</summary>
    private static IEnumerable<JsonElement> ByProfile(JsonElement root, string name) =>
        Array(root, name).Where(byProfile => byProfile.ValueKind == JsonValueKind.Object)
            .SelectMany(byProfile => byProfile.EnumerateObject())
            .Where(list => list.Value.ValueKind == JsonValueKind.Array)
            .SelectMany(list => list.Value.EnumerateArray());
}
