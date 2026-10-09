### Fix: "Install Ashita v4" failing with `EINVAL: invalid argument, mkdir`
Settings are saved in `%APPDATA%\xi-launcher` and can outlive the launcher folder they point into — for example after a drive was lost and the launcher was reinstalled somewhere else. The launcher kept trying to install Ashita into the old, dead location. It now notices that a saved Ashita or xiloader folder belongs to a launcher that no longer exists and switches to its own `runtime` folder. Folders you chose yourself are never changed. If Windows still rejects a folder, the error now names the folder and tells you where to change it.

### Fix: fresh installs could not connect to LevelDown
The built-in default server address was a raw IP that no longer answers. New installs now default to `leveldownffxi.com`.

### Servers: LevelDown is also listed under 99
75 and 99 players share one LevelDown server, so it now appears under both "75 - Custom Content" and "99 - Custom Content" in the Servers tab.

### Cleanup
Removed an unused component.

**Download:** XI-Launcher.zip (~280 MB, includes launcher music)
Extract and run XI Launcher.exe — no installer.
