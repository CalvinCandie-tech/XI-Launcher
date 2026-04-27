export const PROFILE_BOOT_SECTION = (type, name, serverHost, serverPort, xiloaderPath, hairpin, loginUser, loginPass) => {
  if (type === 'retail') {
    return `[ashita.launcher]
autoclose    = 1
name         = ${name}

[ashita.boot]
file         =
command      = /game eAZcFcB
gamemodule   = ffximain.dll
script       = default.txt
args         =`;
  }
  const xiloaderExe = xiloaderPath ? xiloaderPath.replace(/\//g, '\\') + '\\xiloader.exe' : '.\\xiloader\\xiloader.exe';
  const args = ['--server', serverHost || '127.0.0.1'];
  if (serverPort) args.push('--serverport', serverPort);
  if (loginUser) args.push('--user', loginUser);
  if (loginPass) args.push('--pass', loginPass);
  if (hairpin) args.push('--hairpin');
  return `[ashita.launcher]
autoclose    = 1
name         = ${name}

[ashita.boot]
file         = ${xiloaderExe}
command      = ${args.join(' ')}
gamemodule   = ffximain.dll
script       = default.txt
args         =`;
};

export const DEFAULT_PROFILE_INI = (name, type, serverHost, serverPort, xiloaderPath, hairpin, loginUser, loginPass, ffxiPath) => `${PROFILE_BOOT_SECTION(type, name, serverHost, serverPort, xiloaderPath, hairpin, loginUser, loginPass)}

[ashita.fonts]
d3d8.disable_scaling = 0
d3d8.family  = Arial
d3d8.height  = 10

[ashita.input]
gamepad.allowbackground       = 0
gamepad.disableenumeration    = 0
keyboard.blockinput           = 0
keyboard.blockbindsduringinput = 1
keyboard.silentbinds          = 0
keyboard.windowskeyenabled    = 0
mouse.blockinput              = 0
mouse.unhook                  = 1

[ashita.language]
playonline   = 2
ashita       = 2

[ashita.logging]
level        = 5
crashdumps   = 1

[ashita.misc]
addons.silent  = 0
aliases.silent = 0
plugins.silent = 0

[ashita.addons]
enternity = 1
cleancs = 1

[ashita.polplugins]
pivot = 1
sandbox = 0

[ashita.polplugins.args]

[ashita.resources]
offsets.use_overrides   = 1
pointers.use_overrides  = 1
resources.use_overrides = 1

[ashita.taskpool]
threadcount  = -1

[ashita.window.startpos]
x            = -1
y            = -1

[ffxi.direct3d8]
presentparams.backbufferformat                = -1
presentparams.backbuffercount                 = -1
presentparams.multisampletype                 = -1
presentparams.swapeffect                      = -1
presentparams.enableautodepthstencil          = -1
presentparams.autodepthstencilformat          = -1
presentparams.flags                           = -1
presentparams.fullscreen_refreshrateinhz      = -1
presentparams.fullscreen_presentationinterval = -1
behaviorflags.fpu_preserve                    = 0

[ffxi.registry]
0000 = 6
0001 = 1920
0002 = 1080
0003 = 4096
0004 = 4096
0005 = -1
0006 = -1
0007 = 1
0008 = -1
0009 = -1
0010 = -1
0011 = 2
0012 = -1
0013 = -1
0014 = -1
0015 = -1
0016 = -1
0017 = 0
0018 = 2
0019 = 1
0020 = 0
0021 = 1
0022 = 0
0023 = 0
0024 = -1
0025 = -1
0026 = -1
0027 = -1
0028 = 0
0029 = 20
0030 = 0
0031 = 1002740646
0032 = 0
0033 = 0
0034 = 1
0035 = 1
0036 = 2
0037 = 1920
0038 = 1080
0039 = 1
0040 = 0
0041 = 0
0042 = ${ffxiPath || 'C:\\Program Files (x86)\\PlayOnline\\SquareEnix\\FINAL FANTASY XI'}
0043 = 1
0044 = 1
0045 = 0
padexsin000 = -1
padguid000 = -1
padmode000 = -1
padsin000 = -1
`;
