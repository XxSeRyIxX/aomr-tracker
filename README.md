# AoM Retold Tracker

Every achievement and every badge of **Age of Mythology: Retold** in one place, with how far along you are on the ones you don't have yet: which gods still count for *Connoisseur of the Gods*, which legends for *A Legendary Rush*, how many labyrinth runs you have for *Demigod*, which Greek gods you already beat a labyrinth boss with...

**[Open the website](https://xxseryixx.github.io/aomr-tracker/)** or **[download the desktop app](https://github.com/XxSeRyIxX/aomr-tracker/releases/latest)**. Free, in English and Spanish.

It is one web app in two editions that show the same things:

| | Website (GitHub Pages) | Desktop app (Windows, macOS, Linux) |
| --- | --- | --- |
| All achievements and badges, art, goals, rarity | Yes | Yes |
| Your achievements, badges and badge progress | Drop or choose your game folder, once | Found by itself, and updated while you play |
| Counters (*2,500 / 10,000 units*) | From the same folder | From the same folder |
| Xbox and PlayStation | Type your in-game name: found through a relay | Type your in-game name: found by itself |
| Without loading your progress | Manual mode: the ✓ on each card | Manual mode: the ✓ on each card |
| Anything your data doesn't show | Mark it in the card's details | Mark it in the card's details |
| Move to another device, or keep a backup | Save and load a copy | Save and load a copy |
| Works offline | Yes, after the first visit | Yes, except Refresh |
| Install | Nothing | Nothing: one file |

English and Spanish: the names and goals come from the game itself in the same language as the interface, so the two never mix.

## What it shows

- **Achievements** (all of them): the game's own picture of each, unlocked or not, with the unlock date, and how rare each one is among Steam players.
  - Counters for the locked ones, from the game's own statistics: *Defeat 10000 units* shows 2,500 / 10,000. A counter at its goal counts as unlocked when nothing else says.
  - Checklists where the game keeps one: the gods for *Connoisseur of the Gods*, the legends for *A Legendary Rush*, the cultures for *Titanic Terror*.
  - Filter by state (locked, in progress, unlocked) and category (campaigns and battles, Gauntlet, Arena of the Gods, matches), search (accents optional), sort by closest, recent, rarest, name or game order.
  - Descriptions Steam hides stay hidden until unlocked, as on Steam. Steam hides none of this game's today, so the *Show hidden descriptions* box only appears if it ever does.
- **Badges** (all of them): the badge art, its name and goal in the game's words, the date you earned it, and how far along you are on the rest: each god of the "every god" badges (*Conqueror of Olympus*, *Progenitor*, *Supreme Deity*...), counts such as 3 / 5 runs for *Demigod*, and your current streak for *The Lucky* and *Flawless Executioner*.
- **Marks**: on a first visit the page offers two ways in: *Load your progress* or *Manual mode*. In manual mode every card has a round ✓: one click marks it, another takes the mark away, and each mark is kept at once, with nothing to save. The choice is kept, so the next visit opens in manual mode. Load your progress at any time from the *Manual mode* button at the top (the game's folder, Steam's files or your public profile) and the cards show your data instead; forgetting it brings manual mode back, and loading a copy saved in manual mode keeps you in it. With your data loaded, anything it doesn't show (a god of a badge, an entry of a checklist, or a whole achievement) is marked in the card's details. A marked card stays where it is until the list is sorted, filtered or searched again. Real data always wins over a mark, and cards say where each "done" came from.
- **A copy of your progress**: *Save a copy* in *Your progress* writes one small file with your game files, public profile and marks. *Load a copy* (or dropping the file on the page) puts it in another browser or device, after asking. The desktop app takes a copy's marks and profile, since it reads your game files itself.
- Every card has the same size; click one for everything about it. *Closest to unlocking* lists what you're nearest to.
- The tabs are links (`#achievements`, `#badges`), so a bookmark opens the one you want.

## Where your progress comes from

### The game's own folder

The game keeps everything the tracker needs in its own folder, whatever store or system it runs on:

| System | Folder |
| --- | --- |
| Windows | `%USERPROFILE%\Games\Age of Mythology Retold` |
| Linux and Steam Deck (Proton) | `~/.local/share/Steam/steamapps/compatdata/1934680/pfx/drive_c/users/steamuser/Games/Age of Mythology Retold`, or the same under the Steam library the game is in (another drive, the SD card) |
| macOS (CrossOver, Whisky) | `drive_c/users/crossover/Games/Age of Mythology Retold` inside the bottle where Steam runs |

In it:

- `temp/RLink/<player>item-athens-<build>.dat`: the game's copy of what its servers know about you, saved while you play. Your achievements, your badges and titles, and the progress of every badge challenge. It is zlib-compressed JSON.
- `temp/RLink/ItemCategoryCache-…`, `ChallengeGetChallengesCache-…`, `GetAvailableAchievementsCache-…`: the lists of badges, challenges and achievements of the version you have installed.
- `<player>/users/lcs.dat`: the game's statistics, behind the counters. It is encrypted; the tracker decrypts it with the key the game uses.

On the **website**, open the folder that holds it (`%USERPROFILE%\Games` on Windows) and drag the `Age of Mythology Retold` folder onto the page, or click the box and choose that folder. The page looks only for these files (skipping replays, saves and mods), reads them in the page and keeps them in your browser. Nothing is uploaded. The **desktop app** finds the folder by itself: on Windows; in the Proton prefix of every Steam library on Linux (native Steam, Flatpak and Snap); and in Wine bottles (CrossOver and Whisky on macOS, Bottles, Lutris and `~/.wine` on Linux). If the game keeps it somewhere else, *Choose folder…* remembers it. Whenever the game saves, the app reads the files again.

The game saves this copy while it is online, so it shows your progress as of the game's last save.

### Steam's files (optional)

Steam keeps its own copy of your achievements in `appcache/stats` in its folder: `UserGameStats_<account>_1934680.bin` (your unlocks, with Steam's times) and `UserGameStatsSchema_1934680.bin` (the list, only needed for achievements newer than the tracker's own). Neither is needed, but Steam writes its file the moment you unlock an achievement, while the game's copy can miss the ones of your last match until you play online again: Steam's file fills that gap. The desktop app reads them when it finds them; on the website, drag those two files onto the page or use *Choose files…*.

### Public profile: Xbox, PlayStation or another PC

The game's servers publish every player's achievements and earned badges. Names are matched exactly as the game writes them: capitals count.

- The **desktop app** asks the servers itself: type your in-game name or Steam ID and press *Find me*. It reads your badges and achievements, and again on every refresh.
- The **website** can't ask them directly: the servers don't let other websites read them (no CORS), and GitHub Pages runs no code. It asks through its own relay instead, a small Cloudflare Worker that reads only those public pages and only for this site, so it works the same: type your name and press *Find me*. Only the name you look up and the pages it finds go through the relay; nothing else leaves the browser.
- When the relay fails or can't be reached, the website shows the steps by hand instead: type your name, open each page and copy all of it. When you come back, the page reads the copied page by itself where the browser lets it (Chrome and Edge ask once); anywhere else, paste it in the box or press *Read*. Whatever the browser adds around the page is ignored. In Spain, some internet providers block Cloudflare's addresses during LaLiga matches, by court order, and the relay with them; the desktop app isn't affected.

Badge progress per god isn't public; for that, tick the gods yourself.

## Desktop app

Download it from the [releases](https://github.com/XxSeRyIxX/aomr-tracker/releases/latest):

- **Windows**: `AoMRTracker-windows-x64.exe`. It uses WebView2, which Windows 10 and 11 already include.
- **macOS**: `AoMRTracker-macos-arm64.dmg` (Apple silicon) or `-macos-x64.dmg` (Intel). Open it and drag the app to Applications. macOS 12 or later.
- **Linux and Steam Deck**: `AoMRTracker-linux-x64`, then `chmod +x`. It needs WebKitGTK 4.1 (`libwebkit2gtk-4.1`); on the Steam Deck, run it in Desktop Mode.

Each is a single self-contained file, with no runtime and no installer. The builds are unsigned: only override a publisher warning for a download you trust. On macOS, after trying to open the app, use System Settings > Privacy & Security > Open Anyway.

The app shows a loading screen while it reads the game's files. **Refresh** asks the game's servers for public data only (the newest badge and achievement lists, Steam's rarity, and your public profile), with no sign-in. Your settings stay in the app's own folder: `%LOCALAPPDATA%\AoMRTracker`, `~/.local/share/AoMRTracker` or `~/Library/Application Support/AoMRTracker`.

There is no telemetry in either edition.

## Game updates

What exists comes from data, not from code, so new achievements and badges show up on their own:

- The **desktop app** reads Steam's achievement list, the game's texts and its art from your installation, every time.
- Both editions also read the lists of badges, challenges and achievements from your game's folder, so they know whatever your installed version knows, before the site is updated.
- The **website** ships its own copy too: the game's texts, Steam's achievement list (its English and Spanish texts only) and the game's pictures of the badges and achievements (`tools/export`, which needs the game installed), and the servers' public lists (`tools/server-data.mjs`). After a game update, run them and commit what they write:

  ```powershell
  dotnet run --project tools/export -c Release
  node tools/server-data.mjs app
  ```

  `tests/bundle.test.mjs` then checks that every badge has its art, its name and its goal in both languages, that every achievement has its picture, and that no achievement the servers list is missing from the shipped list. With a free [Steam Web API key](https://steamcommunity.com/dev/apikey) in `STEAM_API_KEY`, `server-data.mjs` also writes the texts and icons of every achievement.

The art ships as two files, `app/art/achievements.pack` and `app/art/badges.pack`, with every image one after another, and an index for each (`.json`). The page downloads each once, after it first shows those cards, and cuts each image out of it in memory as its card comes into view. The game's pictures of locked achievements are the same ones in grey, which the page does itself. Steam's icons are only a fallback for achievements newer than the shipped art.

The only lists in the code are the ones the game stores as bare numbers (gods and legends by their position in a statistic). A new god or legend still counts, and shows as `#24` until it is added to `GODS` or `LEGENDS` in `app/core.js`.

## Build

Needs the .NET 10 SDK and Node.js 24 (for the tests).

```powershell
dotnet run --project shell                       # the desktop app from source; add -- --dev for the web inspector
node --test tests/*.test.mjs                     # the page: files, achievements, badges, texts and the shipped data
dotnet run --project tests/shell -c Release      # the desktop side: folders on every system, files, art, messages, storage
dotnet publish shell -c Release -r win-x64 -o publish   # one self-contained app; osx-arm64, osx-x64, linux-x64 too
```

`app/` is the website as it is: serve the folder with any static server to try it. `tools/make-icon.ps1` draws the icon into `app/icon.png` and `shell/icon.ico`, and the link preview `app/social.png` (also the repository's social preview).

## Deploy

- **Website**: every push to `main` that changes `app/` runs `.github/workflows/pages.yml`: the checks on Windows, macOS and Linux, then GitHub Pages (Settings > Pages > Source: *GitHub Actions*). It can also be run by hand from the Actions tab.
- **Desktop app**: every push to `main` builds the four downloads as workflow artifacts (`.github/workflows/build.yml`); a tag like `v1.2.3` also publishes them as a release, with that version.
- **Relay**: `relay/worker.js`, a [Cloudflare Worker](https://developers.cloudflare.com/workers/). The free plan is enough (100,000 requests a day, three per lookup) and nothing expires while it goes unused. Deploy it from `relay/` with `npx wrangler deploy`, which asks you to sign in to Cloudflare and, the first time, to pick your `workers.dev` name; deploy again when `worker.js` changes. Put the address it prints in the repository variable `RELAY_URL` (Settings > Secrets and variables > Actions > Variables): the Pages workflow writes it to `app/config.json`, which git ignores and the desktop app doesn't include. Without it, the site shows the steps by hand. The relay only answers the site in `SITE` (`relay/wrangler.toml`) and pages served from the same computer, so you can try it locally with that address in `app/config.json` (`{"relay": "https://..."}`). The page may only connect to `*.workers.dev` (its Content-Security-Policy in `index.html`): a relay on another domain needs adding there.

## How it is made

- `app/`: the interface, a web page with no framework and no build step. `files.js` decodes the player's files (the game's cache and statistics, Steam's binary KeyValues) and pasted profile pages, `sources.js` gathers them (dropped or chosen folders, the desktop's files, the browser's storage), `core.js` merges everything and turns it into cards, `i18n.js` holds the English and Spanish texts, `native.js` talks to the desktop side. `data/` and `art/` hold the game data the website ships.
- `shell/`: the desktop side in C# with [Photino](https://www.tryphotino.io/), which shows the same page in the system's own web view. It finds the game's folder, the game's install and Steam's files (`Locations.cs`), serves the player's files to the page under `/local/`, where the page decodes them with the website's own code, draws the art of badges and achievements the site doesn't ship from the game's archives, and reads public data from the servers, including the public profile of a player it is given the name of. On Windows the page comes from memory at `http://127.0.0.1:5190`, with no open port; on macOS and Linux, from a loopback server on that address that only answers requests for it.
- `tools/export`: writes the game's texts, Steam's achievement list and the art of the badges and achievements from an installed game.
- `tools/server-data.mjs`: writes `app/data/server.json` from the game's public API and Steam.
- `relay/`: the website's relay to the public profile pages on the game's servers, a Cloudflare Worker.

## License

GNU AGPL v3 or later, with additional terms under section 7: see [LICENSE](LICENSE) and [NOTICE](NOTICE). The game material in `app/data` and `app/art` is not covered by it: see [app/art/NOTICE.txt](app/art/NOTICE.txt).

AoM Retold Tracker was created under Microsoft's "Game Content Usage Rules" using assets from Age of Mythology: Retold, and it is not endorsed by or affiliated with Microsoft.
