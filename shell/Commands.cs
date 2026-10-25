// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization.Metadata;

namespace AoMRTracker;

/// <summary>
/// What the page can ask the shell for (app/native.js), and the answers. pickFolder shows the system's folder dialog
/// with a title and a folder to start in, and returns the chosen folder or null.
/// </summary>
internal sealed class Commands(Tracker tracker, Func<string, string, string?> pickFolder)
{
    private static readonly ShellJson J = ShellJson.Default;

    public async Task<JsonNode?> RunAsync(string cmd, JsonElement args, CancellationToken ct)
    {
        switch (cmd)
        {
            case "load":
                return Node(tracker.Load(Read(args, J.LoadRequest).Lang), J.Snapshot);
            case "stamp":
                return Node(tracker.Stamp(), J.Stamp);
            case "refresh":
                return Node(await tracker.RefreshAsync(Read(args, J.RefreshRequest).ProfileId, ct), J.OnlineData);
            case "profile":
                ProfileRequest player = Read(args, J.ProfileRequest);
                return Node(await tracker.ProfileAsync(player.Name, player.Id, ct), J.PublicProfile);
            case "choose":
                string title = Read(args, J.ChooseRequest).Title;
                string? picked = pickFolder(title.Length > 200 ? title[..200] : title, tracker.StartFolder);
                return JsonValue.Create(picked is not null && tracker.Choose(picked));
            case "open":
                Desktop.Open(Read(args, J.OpenRequest).Url);
                return null;
            default:
                throw new ApiException(400, "bad-request", "Unknown command.");
        }
    }

    private static T Read<T>(JsonElement args, JsonTypeInfo<T> info)
    {
        try
        {
            return args.ValueKind == JsonValueKind.Object && args.Deserialize(info) is { } value ? value : throw new ApiException(400, "bad-request", "Bad request.");
        }
        catch (JsonException)
        {
            throw new ApiException(400, "bad-request", "Bad request.");
        }
    }

    private static JsonNode? Node<T>(T value, JsonTypeInfo<T> info) => JsonSerializer.SerializeToNode(value, info);
}
