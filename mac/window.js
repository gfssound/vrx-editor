// VRX Editor: the Mac app's own window (JavaScript for Automation, compiled by osacompile in the builder).
// Starts the editor's server hidden (node server.js), then shows its page in a WebKit window.
// Closing the window quits; the server stops by itself when the app is gone (--exit-with).
// Hold Option while opening the app to start with two simulated VRX units.
ObjC.import('Cocoa');
ObjC.import('WebKit');

var G = {}; // keeps Cocoa objects alive for the life of the app

function sa() { var a = Application.currentApplication(); a.includeStandardAdditions = true; return a; }
function exists(p) { return $.NSFileManager.defaultManager.fileExistsAtPath(p); }
function readText(p) { var s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null); return s.isNil() ? '' : s.js; }
function writeText(p, t) { $(t).writeToFileAtomicallyEncodingError(p, true, $.NSUTF8StringEncoding, null); }

// The app carries Node.js for Apple Silicon (node/arm64), Intel (node/x64) or both. An Apple Silicon Mac can also run
// the Intel one (Rosetta); an Intel Mac can't run the Apple Silicon one.
function machine() { try { return sa().doShellScript('uname -m'); } catch (e) { return ''; } }
function findNode(res) {
  var mine = machine() === 'arm64' ? ['arm64', 'x64'] : ['x64'];
  var list = mine.map(function (a) { return res + '/node/' + a + '/node'; }).concat([res + '/node/node']);
  var saved = readText(res + '/node-path').trim();
  if (saved) list.push(saved);
  list = list.concat(['/usr/local/bin/node', '/opt/homebrew/bin/node', '/opt/local/bin/node']);
  for (var i = 0; i < list.length; i++) if ($.NSFileManager.defaultManager.isExecutableFileAtPath(list[i])) return list[i];
  return '';
}

function fail(dataDir, msg) {
  try { writeText(dataDir + '/window-error.txt', new Date().toString() + '\n' + msg + '\n'); } catch (e) { /* ignore */ }
  var a = sa();
  a.displayAlert('VRX Editor could not start', { message: msg, as: 'critical', buttons: ['Quit'] });
  $.NSApplication.sharedApplication.terminate(null);
}

function run() {
  var app = $.NSApplication.sharedApplication;
  var fm = $.NSFileManager.defaultManager;
  var res = $.NSBundle.mainBundle.resourcePath.js;
  var dataDir = $.NSHomeDirectory().js + '/Library/Application Support/VRX Editor';
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dataDir, true, $(), null);
  var logPath = dataDir + '/app.log', portFile = dataDir + '/port';
  try {
    fm.removeItemAtPathError(portFile, null);
    var node = findNode(res);
    if (!node && machine() !== 'arm64' && exists(res + '/node/arm64/node')) return fail(dataDir, 'This is the Apple Silicon version of VRX Editor, and this Mac has an Intel processor. Download the Intel version (VRX-Editor-…-Intel.dmg) instead.');
    if (!node) return fail(dataDir, 'Node.js was not found. Install it from nodejs.org (the LTS installer), then open VRX Editor again.');

    // Server: hidden, logging to ~/Library/Application Support/VRX Editor/app.log
    if (!exists(logPath)) fm.createFileAtPathContentsAttributes(logPath, $(), $());
    var out = $.NSFileHandle.fileHandleForWritingAtPath(logPath);
    out.seekToEndOfFile;
    var args = [res + '/app/server.js', '--no-open', '--port', '8095', '--port-file', portFile, '--log', logPath,
      '--exit-with', String($.NSProcessInfo.processInfo.processIdentifier)];
    var optionKey = ($.NSEvent.modifierFlags & (1 << 19)) !== 0;
    if (optionKey) args.push('--simulate', '2');
    var task = $.NSTask.alloc.init;
    task.setLaunchPath(node);
    task.setArguments($(args));
    task.setCurrentDirectoryPath(res + '/app');
    task.setStandardOutput(out);
    task.setStandardError(out);
    task.launch;
    G.task = task;

    var port = '';
    for (var i = 0; i < 150 && !port; i++) {
      delay(0.1);
      if (exists(portFile)) port = readText(portFile).trim();
      if (!task.isRunning) break;
    }
    if (!port) return fail(dataDir, 'The editor\'s server did not start. Details are in ' + logPath);
    var url = 'http://127.0.0.1:' + port + '/';
    G.url = url; G.dataDir = dataDir; G.logPath = logPath;

    // Window
    var win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, 1300, 900), 1 | 2 | 4 | 8, 2, false);
    win.setTitle('VRX Editor');
    win.setReleasedWhenClosed(false);
    win.setMinSize($.NSMakeSize(900, 600));
    win.setCollectionBehavior(1 << 7); // full screen allowed
    try { win.setAppearance($.NSAppearance.appearanceNamed('NSAppearanceNameDarkAqua')); } catch (e) { /* older macOS */ }
    win.setBackgroundColor($.NSColor.colorWithSRGBRedGreenBlueAlpha(0.102, 0.106, 0.114, 1));
    var conf = $.WKWebViewConfiguration.alloc.init;
    var web = $.WKWebView.alloc.initWithFrameConfiguration($.NSMakeRect(0, 0, 1300, 900), conf);
    web.setAutoresizingMask(2 | 16);
    try { web.setValueForKey($.NSNumber.numberWithBool(false), 'drawsBackground'); } catch (e) { /* keep default */ }
    win.setContentView(web);
    if (!win.setFrameUsingName('VRXEditorMain')) win.center;
    win.setFrameAutosaveName('VRXEditorMain');
    G.win = win; G.web = web;

    ObjC.registerSubclass({
      name: 'VRXEditorHelper',
      superclass: 'NSObject',
      methods: {
        'windowWillClose:': { types: ['void', ['id']], implementation: function () { $.NSApplication.sharedApplication.terminate(null); } },
        'reloadPage:': { types: ['void', ['id']], implementation: function () { G.web.reload; } },
        'openInBrowser:': { types: ['void', ['id']], implementation: function () { $.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString(G.url)); } },
        'showLogFolder:': { types: ['void', ['id']], implementation: function () { $.NSWorkspace.sharedWorkspace.selectFileInFileViewerRootedAtPath(G.logPath, ''); } }
      }
    });
    G.helper = $.VRXEditorHelper.alloc.init;
    win.setDelegate(G.helper);

    // View menu: Reload, Open in Web Browser, Show Log
    try {
      var bar = app.mainMenu;
      if (!bar.isNil()) {
        var menu = $.NSMenu.alloc.initWithTitle('View');
        var add = function (title, sel, key, mods) {
          var mi = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(title, sel, key);
          mi.setTarget(G.helper);
          if (mods) mi.setKeyEquivalentModifierMask(mods);
          menu.addItem(mi);
        };
        add('Reload', 'reloadPage:', 'r');
        add('Open in Web Browser', 'openInBrowser:', 'b', (1 << 20) | (1 << 17));
        add('Show Log in Finder', 'showLogFolder:', '');
        var top = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('View', null, '');
        top.setSubmenu(menu);
        bar.insertItemAtIndex(top, Math.min(3, bar.numberOfItems));
        G.menu = menu; G.top = top;
      }
    } catch (e) { /* menus are optional */ }

    web.loadRequest($.NSURLRequest.requestWithURL($.NSURL.URLWithString(url)));
    win.makeKeyAndOrderFront(null);
    app.activateIgnoringOtherApps(true);
  } catch (e) {
    fail(dataDir, 'Window error: ' + e + '\nDetails are in ' + logPath);
  }
}
