using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using AoMRTracker;

void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

// The app's own files: exact names only, so nothing outside app/ can be reached.
Check(Site.Open("/") is { Type: "text/html; charset=utf-8" }, "The root must serve index.html.");
Check(Site.Open("/app.js?v=abc1234") is { Type: "text/javascript; charset=utf-8" }, "Module URLs with a query must be served.");
Check(Site.Open("/sources.js") is { Type: "text/javascript; charset=utf-8" }, "Every module must be served.");
foreach (string target in new[] { "/../shell/Program.cs", "/%2e%2e/LICENSE", "/..%2fNOTICE", "/APP.JS", "/app.js%00", "//app.js/..",
             "/media/badge/../../shell/icon.ico", "/media/badge/The_Swift.png", "/media/badge/a b.png", "/media/badge/x.dds", "/media/other.jpg",
             "/media/badge/not_a_real_badge.png", "/media/achievement/../x.png", "/media/achievements/achievement_annihilation.png",
             "/media/achievement/Achievement_Annihilation.png", "/local/../settings.json", "/local/STATS", "/local/lcs.dat" })
    Check(Site.Open(target) is null, $"{target} must not be served.");

// Links that leave the app: web only, anything else could start a program.
foreach (string url in new[] { "https://github.com/XxSeRyIxX", "http://example.com/" })
    Check(Desktop.SafeLink(url) is not null, $"{url} must open.");
foreach (string url in new[] { "file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "ms-msdt:/id", "mailto:x@example.com", "steam://run/1934680",
             "/relative", "", "https://example.com/\nx" })
    Check(Desktop.SafeLink(url) is null, $"{url} must not open.");

// Steam ids name files, so only real ones pass.
Check(Steam.IsSteamId("76561197989676140"), "A SteamID64 must pass.");
foreach (string? id in new[] { null, "", "123", "../../evil", "7656119798967614x", "76561197989676140 ", "00000000000000001" })
    Check(!Steam.IsSteamId(id), $"\"{id}\" must not pass as a Steam id.");
Check(Steam.AccountId("76561197989676140") == 29410412, "The account id is the SteamID64 minus the base.");

// Steam's text files: loginusers.vdf blocks and escaped values.
const string loginUsers = "\"users\"\n{\n\t\"76561197989676140\"\n\t{\n\t\t\"AccountName\"\t\t\"someone\"\n\t\t\"PersonaName\"\t\t\"Se\\\"ry\"\n\t\t\"MostRecent\"\t\t\"1\"\n\t}\n}\n";
var user = Steam.LoginUser().Match(loginUsers);
Check(user.Success && user.Groups[1].Value == "76561197989676140", "loginusers.vdf blocks must be found.");
Check(Steam.VdfValue(user.Groups[2].Value, "PersonaName") == "Se\"ry", "Escaped quotes must be read.");
Check(Steam.VdfValue(user.Groups[2].Value, "mostrecent") == "1", "Keys are case-insensitive.");

// The Windows Steam of a Wine bottle writes Windows paths: they are the bottle's drives elsewhere.
string bottleSteam = Path.Combine("bottles", "Steam", "drive_c", "Program Files (x86)", "Steam");
Check(Steam.InBottle(@"D:\Games\SteamLibrary", bottleSteam, Platform.MacOS) == Path.Combine("bottles", "Steam", "dosdevices", "d:", "Games", "SteamLibrary"),
    "A library on D: is the bottle's dosdevices/d: folder.");
Check(Steam.InBottle(@"D:\Games", "/home/someone/.local/share/Steam", Platform.Linux) is null, "A Windows path outside any bottle leads nowhere.");
Check(Steam.InBottle("/mnt/games/SteamLibrary", "/home/someone/.local/share/Steam", Platform.Linux) == "/mnt/games/SteamLibrary", "Native paths stay.");
Check(Steam.InBottle(@"D:\Games", @"C:\Steam", Platform.Windows) == @"D:\Games", "On Windows, paths are what they say.");

// The game's string table: only the texts the page uses, unescaped.
var table = StringTables.Parse("ID = \"STR_CIV_ZEUS\"   ;   Str = \"Zeus\"\r\nID = \"STR_BDGTTL_OBJECTIVE_01\" ; Str = \"Win in {0} \\\"minutes\\\".\"\nID = \"STR_OTHER\" ; Str = \"x\"\n" +
    "ID = \"STR_CHARACTER_KASTOR\" ; Str = \"Cástor\"\n");
Check(table.Count == 3 && table["STR_CIV_ZEUS"] == "Zeus" && table["STR_BDGTTL_OBJECTIVE_01"] == "Win in {0} \"minutes\"." && table["STR_CHARACTER_KASTOR"] == "Cástor",
    "String table parsing failed.");

// Only the player's own files have /local/ names.
Located located = new("folder", new PlayerFiles("folder", "1", "cache.dat", "lcs.dat", "items.dat", "challenges.dat", "ids.dat"), null, "user.bin", "schema.bin");
foreach (var (name, file) in new[] { ("cache", "cache.dat"), ("stats", "lcs.dat"), ("items", "items.dat"), ("challenges", "challenges.dat"),
             ("achievement-ids", "ids.dat"), ("steam-user", "user.bin"), ("steam-schema", "schema.bin") })
    Check(located.Path(name) == file, $"/local/{name} must be {file}.");
foreach (string name in new[] { "", "lcs.dat", "../stats", "stats/..", "STATS", "steam-user/../../x", "C:\\Windows\\win.ini", "folder" })
    Check(located.Path(name) is null, $"\"{name}\" must not name a file.");

// Textures: one BC3 block, then the PNG writer.
byte[] dds = new byte[128 + 16];
"DDS "u8.CopyTo(dds);
BinaryPrimitives.WriteInt32LittleEndian(dds.AsSpan(4), 124);
BinaryPrimitives.WriteInt32LittleEndian(dds.AsSpan(12), 4);
BinaryPrimitives.WriteInt32LittleEndian(dds.AsSpan(16), 4);
BinaryPrimitives.WriteInt32LittleEndian(dds.AsSpan(76), 32);
BinaryPrimitives.WriteInt32LittleEndian(dds.AsSpan(80), 4);
"DXT5"u8.CopyTo(dds.AsSpan(84));
byte[] block = [255, 0, 0x01, 0, 0, 0, 0, 0, 0x00, 0xF8, 0x1F, 0x00, 0xE4, 0, 0, 0];
block.CopyTo(dds, 128);
var image = Dds.Decode(dds);
Check(image is { Width: 4, Height: 4 }, "A 4x4 BC3 texture must decode.");
byte[] px = image!.Value.Rgba;
Check(px.AsSpan(0, 16).SequenceEqual(new byte[] { 255, 0, 0, 0, 0, 0, 255, 255, 170, 0, 85, 255, 85, 0, 170, 255 }),
    $"BC3 colours or alpha are wrong: {string.Join(',', px.Take(16))}");
Check(px.AsSpan(16, 4).SequenceEqual(new byte[] { 255, 0, 0, 255 }), "The second row starts with colour 0, fully opaque.");
Check(Dds.Decode("not a texture"u8.ToArray()) is null && Dds.Decode(dds[..130]) is null, "Anything but a whole texture must be refused.");

// Halving weighs colour by alpha, so a see-through pixel doesn't darken its neighbours.
var (halfW, halfH, half) = Dds.Half(2, 2, [200, 100, 0, 255, 0, 0, 0, 0, 200, 100, 0, 255, 0, 0, 0, 0]);
Check(halfW == 1 && halfH == 1 && half.SequenceEqual(new byte[] { 200, 100, 0, 128 }), $"Halving is wrong: {string.Join(',', half)}");

byte[] png = PngFile.Encode(1, 1, [1, 2, 3, 4]);
Check(png.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }), "PNG signature.");
Check(png.AsSpan(png.Length - 4).SequenceEqual(new byte[] { 0xAE, 0x42, 0x60, 0x82 }), "The IEND checksum is fixed.");
uint ihdrCrc = BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(8 + 8 + 13));
Check(ihdrCrc == (PngFile.Crc(0xFFFFFFFF, png.AsSpan(12, 17)) ^ 0xFFFFFFFF), "The IHDR checksum must match.");

// Messages: camelCase both ways, strict about required values.
Request request = JsonSerializer.Deserialize("""{"id":"a-1","cmd":"load","args":{"lang":"es"}}""", ShellJson.Default.Request)!;
Check(request.Args.Deserialize(ShellJson.Default.LoadRequest)!.Lang == "es", "Request arguments must be read.");
Check(JsonSerializer.Deserialize("""{"profileId":null}""", ShellJson.Default.RefreshRequest)!.ProfileId is null
    && JsonSerializer.Deserialize("{}", ShellJson.Default.RefreshRequest)!.ProfileId is null
    && JsonSerializer.Deserialize("""{"profileId":1077381382}""", ShellJson.Default.RefreshRequest)!.ProfileId == 1077381382, "The profile id is optional.");
Check(JsonSerializer.Deserialize("""{"name":"XxSeRyIxX"}""", ShellJson.Default.ProfileRequest) is { Name: "XxSeRyIxX", Id: null }
    && JsonSerializer.Deserialize("""{"id":1077381382}""", ShellJson.Default.ProfileRequest) is { Name: null, Id: 1077381382 }, "A player is asked for by name or by id.");
string reply = JsonSerializer.Serialize(new Reply("a-1", false, Status: 400, Code: "not-game-folder", Error: "No."), ShellJson.Default.Reply);
Check(reply.Contains("\"code\":\"not-game-folder\"") && reply.Contains("\"status\":400"), $"Reply serialized wrongly: {reply}");
foreach (string bad in new[] { """{"lang":null}""", "{}" })
{
    bool refused = false;
    try
    {
        JsonSerializer.Deserialize(bad, ShellJson.Default.LoadRequest);
    }
    catch (JsonException)
    {
        refused = true;
    }
    Check(refused, $"{bad} must be refused: the language is required.");
}
string stamp = JsonSerializer.Serialize(new Stamp(1, 2, 3, 4, 5, 6, 7), ShellJson.Default.Stamp);
Check(stamp == """{"cache":1,"stats":2,"steamUser":3,"steamSchema":4,"items":5,"challenges":6,"achievementIds":7}""", $"The page reads these names: {stamp}");

// Errors: the page gets a code it can translate.
Check(Errors.Explain(new TaskCanceledException("x", new TimeoutException())).Code == "timeout", "Timeouts must say so.");
Check(Errors.Explain(new OperationCanceledException()).Code == "stopped", "Cancelled requests must say so.");
Check(Errors.Explain(new HttpRequestException("no route")).Code == "offline", "Network failures must say so.");
Check(Errors.Explain(new ApiException(400, "not-game-folder", "x")) is (400, "not-game-folder", "x"), "API errors keep their status and code.");

string temp = Path.Combine(Path.GetTempPath(), "aomr-tracker-checks-" + Guid.NewGuid().ToString("N"));
try
{
    // The tracker's own files, written whole.
    Store store = new(Path.Combine(temp, "store"));
    using (JsonDocument groups = JsonDocument.Parse("[[1000,\"Persistent_TheSwift\"]]"))
        store.WriteOnline(new OnlineData(1077381382, "XxSeRyIxX", 5, Earned: new() { [10000] = 1777118765 }, Achievements: new() { [54] = 1776381346 },
            Groups: groups.RootElement.Clone(), AchievementIds: new() { [54] = "ACHIEVEMENT_DREAMWEAVER" }));
    OnlineData? saved = store.ReadOnline();
    Check(saved is { ProfileId: 1077381382, PublicAt: 5 } && saved.Earned![10000] == 1777118765 && saved.Achievements![54] == 1776381346
        && saved.AchievementIds![54] == "ACHIEVEMENT_DREAMWEAVER" && saved.Groups!.Value[0][1].GetString() == "Persistent_TheSwift", "Online data must survive a round trip.");
    string online = File.ReadAllText(Path.Combine(temp, "store", "online.json"));
    Check(online.Contains("\"achievements\":{\"54\":1776381346}"), $"Ids are keys the page can read: {online}");
    Check(store.ReadSettings().GameFolder is null, "No folder is chosen at first.");

    // A computer with the game in several places: Linux (Proton), a Wine bottle on a Mac, and Windows.
    string home = Path.Combine(temp, "home");
    string Make(params string[] parts)
    {
        string path = Path.Combine([home, .. parts]);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, [1]);
        return path;
    }
    void Age(string path, int minutes) => File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddMinutes(-minutes));

    string[] proton = [".local", "share", "Steam", "steamapps", "compatdata", "1934680", "pfx", "drive_c", "users", "steamuser", "Games", GameFolders.Name];
    string oldCache = Make([.. proton, "temp", "RLink", "76561197989676140item-athens-andromeda-live-release9.dat"]);
    string newCache = Make([.. proton, "temp", "RLink", "76561197989676140item-athens-andromeda-live-release21.dat"]);
    Make([.. proton, "temp", "RLink", "ItemCategoryCache-athens-andromeda-live-release21.dat"]);
    Make([.. proton, "temp", "RLink", "live.dat"]);
    string stats = Make([.. proton, "76561197989676140", "users", "lcs.dat"]);
    Make([.. proton, "76561197960265729", "users", "lcs.dat"]);
    Age(newCache, 60);
    Age(stats, 30);

    string[] roots = [.. Steam.Roots(Platform.Linux, home, null)];
    Check(roots.Length == 1 && roots[0].EndsWith(Path.Combine(".local", "share", "Steam")), $"Linux finds Steam's folder: {string.Join(", ", roots)}");
    string? linux = GameFolders.Find(null, Platform.Linux, home, roots);
    Check(linux == Path.Combine([home, .. proton]), $"Linux finds the game's folder in its Proton prefix: {linux}");
    PlayerFiles files = GameFolders.Files(linux);
    Check(files.Cache == newCache, $"The newest game build's cache wins over a newer file of an old build: {files.Cache}");
    Check(files.PlayerId == "76561197989676140" && files.Stats == stats, "The statistics are those of the cache's player.");
    Check(files.Items!.EndsWith("ItemCategoryCache-athens-andromeda-live-release21.dat") && files.Challenges is null, "Each list is found, or not.");

    string[] crossover = ["Library", "Application Support", "CrossOver", "Bottles", "Steam", "drive_c"];
    string macStats = Make([.. crossover, "users", "crossover", "Games", GameFolders.Name, "2535400000000000", "users", "lcs.dat"]);
    string? mac = GameFolders.Find(null, Platform.MacOS, home, []);
    Check(mac == Path.GetDirectoryName(Path.GetDirectoryName(Path.GetDirectoryName(macStats))), $"macOS finds the game's folder in a CrossOver bottle: {mac}");
    Check(GameFolders.Files(mac) is { PlayerId: "2535400000000000", Cache: null } macFiles && macFiles.Stats == macStats, "A player of another platform keeps its id.");
    Directory.CreateDirectory(Path.Combine([home, .. crossover, "Program Files (x86)", "Steam"]));
    Check(Steam.Roots(Platform.MacOS, home, null).Single().EndsWith(Path.Combine("drive_c", "Program Files (x86)", "Steam")), "The bottle's Steam is found.");

    Check(GameFolders.Candidates(Platform.Windows, home, []).First() == Path.Combine(home, "Games", GameFolders.Name), "Windows keeps it in the user's Games folder.");
    Check(GameFolders.Find(null, Platform.Windows, home, []) is null, "No game folder, no folder.");

    // Choosing the folder: itself, the Games folder above it, or one inside it.
    Check(GameFolders.Normalize(Path.Combine([home, .. proton, "76561197989676140", "users"])) == Path.Combine([home, .. proton]), "A folder inside is the game's folder.");
    Check(GameFolders.Normalize(Path.Combine([home, .. proton[..^1]])) == Path.Combine([home, .. proton]), "The Games folder leads to the game's folder.");
    Tracker tracker = new(store, new RelicLink());
    Check(tracker.Choose(Path.Combine([home, .. proton, "temp"])) && store.ReadSettings().GameFolder == Path.Combine([home, .. proton]), "A chosen folder is kept.");
    Check(GameFolders.Find(store.ReadSettings().GameFolder, Platform.Windows, home, []) == Path.Combine([home, .. proton]), "The chosen folder comes first.");
    bool refused = false;
    try
    {
        tracker.Choose(home);
    }
    catch (ApiException e) when (e.Code == "not-game-folder")
    {
        refused = true;
    }
    Check(refused, "A folder without the game's files is refused.");

    // The loopback server of macOS and Linux: GET only, for the app's own host only.
    using SiteServer server = new(0);
    async Task<string> Ask(string head)
    {
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                using TcpClient client = new();
                await client.ConnectAsync(IPAddress.Loopback, server.Port);
                using NetworkStream stream = client.GetStream();
                await stream.WriteAsync(Encoding.ASCII.GetBytes(head));
                using StreamReader reader = new(stream);
                return await reader.ReadToEndAsync();
            }
            catch (IOException) when (attempt < 4) { }
            catch (SocketException) when (attempt < 4) { }
        }
    }
    string host = $"127.0.0.1:{server.Port}";
    string page = await Ask($"GET / HTTP/1.1\r\nHost: {host}\r\n\r\n");
    Check(page.StartsWith("HTTP/1.1 200 OK") && page.Contains("Content-Type: text/html") && page.Contains("<!doctype html>"), "The page is served.");
    Check((await Ask($"GET /app.js HTTP/1.1\r\nHost: evil.example:{server.Port}\r\n\r\n")).StartsWith("HTTP/1.1 421"), "Another host is refused.");
    Check((await Ask("GET /app.js HTTP/1.1\r\n\r\n")).StartsWith("HTTP/1.1 421"), "No host is refused.");
    Check((await Ask($"POST / HTTP/1.1\r\nHost: {host}\r\n\r\n")).StartsWith("HTTP/1.1 405"), "Only GET.");
    Check((await Ask($"GET /../NOTICE HTTP/1.1\r\nHost: {host}\r\n\r\n")).StartsWith("HTTP/1.1 404"), "Nothing outside the app.");
}
finally
{
    Directory.Delete(temp, true);
}

// With the game installed here: real badge and achievement art and the player's real files.
string checkedHere = "";
if (GameInstall.Find() is { } install && File.Exists(GameArt.Archive(install.Dir)))
{
    Site.GameDir = () => install.Dir;
    byte[]? art = GameArt.Png(install.Dir, GameArt.Badges, "the_swift");
    Check(art is not null && BinaryPrimitives.ReadInt32BigEndian(art.AsSpan(16)) == GameArt.Size, $"The Swift's badge must decode to a {GameArt.Size} px PNG.");
    Check(Site.Open("/media/badge/the_swift.png") is { Type: "image/png" }, "Badge art must be served.");
    Check(GameArt.Names(install.Dir, GameArt.Badges).Count() >= 42, "Every badge must be found.");
    byte[]? icon = GameArt.Png(install.Dir, GameArt.Achievements, "achievement_annihilation");
    Check(icon is not null && BinaryPrimitives.ReadInt32BigEndian(icon.AsSpan(16)) == 80, "Annihilation's picture must decode to an 80 px PNG.");
    Check(Site.Open("/media/achievement/achievement_annihilation.png") is { Type: "image/png" }, "Achievement art must be served.");
    string[] pictures = [.. GameArt.Names(install.Dir, GameArt.Achievements)];
    Check(pictures.Length >= 132 && !pictures.Any(n => n.EndsWith("_locked")), "Every achievement must be found, without its grey copy.");
    checkedHere += " Game install found: badge and achievement art decoded.";
}
if (GameFolders.Find(null, Steam.Roots()) is { } folder && GameFolders.Files(folder) is { Cache: not null } real)
{
    Site.LocalFiles = name => new Located(folder, real, null, null, null).Path(name);
    Check(Site.Open("/local/cache?t=1") is { Type: "application/octet-stream", Content.Length: > 1000 }, "The game's cache must be served as it is on disk.");
    checkedHere += $" Game folder found, player {real.PlayerId}.";
}

Console.WriteLine("Desktop checks passed: app files, links, Steam, folders on every system, string tables, textures, PNG, messages, errors, storage and the loopback server." + checkedHere);
