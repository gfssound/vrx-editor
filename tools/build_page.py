#!/usr/bin/env python3
"""Builds VRX Editor's web page (app/public) from the page sources in web/.

web/New-VRX.dc.html is the VRX page of the GuiBridge redesign (copy it over from there when that page changes);
web/TopBar.dc.html is the standalone header; web/vrx-link.js connects the page to this app's server.
Run: python3 tools/build_page.py   (then commit app/public)."""
import json, os, re, shutil
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(HERE, 'web')
PUB = os.path.join(HERE, 'app', 'public')
VERSION = json.load(open(os.path.join(HERE, 'app', 'package.json')))['version']

shutil.rmtree(PUB, ignore_errors=True)
os.makedirs(PUB)
S = {
    'New-VRX': open(os.path.join(WEB, 'New-VRX.dc.html'), encoding='utf-8').read(),
    'TopBar': open(os.path.join(HERE, 'web', 'TopBar.dc.html'), encoding='utf-8').read(),
}
for k in S:
    S[k] = re.sub(r'<link href="https://fonts\.googleapis\.com[^"]*" rel="stylesheet">\n?', '', S[k])
    assert 'googleapis' not in S[k], k
# Standalone wording
S['New-VRX'] = S['New-VRX'].replace('Plug in a VRX to', 'Plug a VRX into this computer with its USB cable to')
shutil.copytree(os.path.join(WEB, 'fonts'), os.path.join(PUB, 'fonts'))
shutil.copy(os.path.join(WEB, 'fonts.css'), PUB)
shutil.copy(os.path.join(WEB, 'dc-player.js'), PUB)
shutil.copy(os.path.join(HERE, 'web', 'vrx-link.js'), PUB)
shutil.copy(os.path.join(HERE, 'web', 'favicon.png'), PUB)
open(os.path.join(PUB, 'sources.js'), 'w', encoding='utf-8').write(
    'window.DC_SOURCES = ' + json.dumps(S, ensure_ascii=False).replace('</', '<\\/') + ';\n')
open(os.path.join(PUB, 'index.html'), 'w', encoding='utf-8').write('''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VRX Editor</title>
<style>
html,body{margin:0;background:#1a1b1d;color:#eceef1;font-family:Inter,Helvetica,Arial,"DejaVu Sans",sans-serif}
#app{min-height:100vh}
dc-host{display:contents}
</style>
<link rel="stylesheet" href="fonts.css">
<link rel="icon" href="favicon.png">
<script src="dc-player.js"></script>
<script src="vrx-link.js"></script>
<script src="sources.js"></script>
</head>
<body>
<div id="app"></div>
<script>
Object.keys(window.DC_SOURCES).forEach(function (n) {
  var s = document.createElement('script');
  s.type = 'text/x-dc-source'; s.dataset.name = n; s.textContent = window.DC_SOURCES[n];
  document.body.appendChild(s);
});
// Start once the server has said which settings it can write, so the page never shows the others.
(function go(n) {
  if (window.GuiBridgeLink.vrxCaps || n > 30) return DCPlayer.start('New-VRX');
  setTimeout(function () { go(n + 1); }, 100);
})(0);
</script>
</body>
</html>
''')
print('public built', {k: len(v) for k, v in S.items()})
