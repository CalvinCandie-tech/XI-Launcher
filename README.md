# XI Launcher

A Windows launcher for Final Fantasy XI private servers. It sets up and starts the game through [Ashita v4](https://www.ashitaxi.com/) and a loader (xiloader by default), and keeps everything around it in one place: profiles, addons, plugins, graphics tools and server settings.

> Not affiliated with or endorsed by Square Enix. FINAL FANTASY is a registered trademark of Square Enix Holdings Co., Ltd. You need your own copy of the game.

## Download

1. Go to the [latest release](https://github.com/CalvinCandie-tech/XI-Launcher/releases/latest) and download **XI-Launcher.zip** (about 280 MB, includes the launcher music).
2. Extract it anywhere you like and run **XI Launcher.exe**. There is no installer.
3. Follow the setup card on the Home screen.

The launcher updates itself from new releases and shows a short "What's new" card after an update.

Windows may warn about an unknown publisher, because the app is not code-signed. Some antivirus programs also flag `xiloader`, which is a known false positive for that tool.

## What it does

- **Start the game** with one click from a saved profile, or start several profiles one after another (Multi-box).
- **Profiles**: create, clone and edit Ashita profiles. Each profile can use the game files installed on your PC or its own separate copy.
- **Loaders**: stock xiloader, or a server-specific loader such as ldloader, picked per profile.
- **Ashita v4**: download and install it for you.
- **Addons and plugins**: browse a catalogue of community addons and plugins, install them, or import your own.
- **XIPivot**: set up HD texture and model packs.
- **dgVoodoo2**: a guided setup (download, Windows Defender exclusion, install, configure, verify).
- **ReShade**: install it and manage effect presets.
- **Servers**: a list of private servers with a connection check, favourites, and the option to add your own.
- **FFXI files updater**: download or refresh a full game client.
- **Requirements checker**: finds missing DirectX, Visual C++ and .NET runtimes and installs them with a single admin prompt.

## Servers

The server list lives in [`servers/servers.json`](servers/servers.json), and the launcher reads it from this repository, so addresses can be fixed without a new release. If a server is missing or has moved, open an issue from the launcher or use the [server suggestion](https://github.com/CalvinCandie-tech/XI-Launcher/issues/new?template=server-suggestion.yml) and [server problem](https://github.com/CalvinCandie-tech/XI-Launcher/issues/new?template=server-problem.yml) forms. A daily check also probes the listed servers and opens an issue when one stays down.

## Reporting problems

Please [open an issue](https://github.com/CalvinCandie-tech/XI-Launcher/issues/new) and say which launcher version you have (shown in the title bar), what you clicked, and the exact error text or a screenshot.
