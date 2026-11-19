import asyncio, json, urllib.request, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8095/'
def state(): return json.load(urllib.request.urlopen(BASE + 'api/state'))
fails = []
def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 860})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto(BASE); await pg.wait_for_timeout(2500)
        await pg.screenshot(path='shots/1-settings.png', full_page=True)
        txt = await pg.inner_text('body')
        ok('2 VRX CONNECTED' in txt, 'two units shown')
        ok('Pilot tone' not in txt, 'pilot tone hidden (not in Zaxcom app)')
        ok(all(x in txt for x in ['Encryption', 'Delay (ms)', 'LITHIUM', 'BALANCED', 'DIM', 'COMP 2', '+6', 'CENTER', 'LEFT', 'LOW']), 'all options shown')
        ok('Loaded from SIM-1001' in txt, 'first unit loaded')
        # change: STEREO, squelch HIGH, gain boost on, CH3 enable, CH2 freq
        await pg.click('[role=group][aria-label="Headphone mode"] button:text-is("STEREO")')
        await pg.click('[role=group][aria-label="Squelch"] button:text-is("HIGH")')
        await pg.click('[role=group][aria-label="Gain boost"] button:text-is("ON")')
        await pg.click('[role=group][aria-label="Voice prompts"] button:text-is("LEFT")')
        await pg.click('[role=group][aria-label="LED"] button:text-is("DIM")')
        d = pg.locator('input[aria-label="Delay (ms)"]'); await d.fill('120'); await d.press('Tab')
        e = pg.locator('input[aria-label="Encryption (hex)"]'); await e.fill('0BEEF5'); await e.press('Tab')
        await pg.click('button[aria-label^="Enable, channel 3"]')
        f = pg.locator('input[aria-label="Channel 2 frequency"]'); await f.fill('216.500'); await f.press('Tab')
        await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/2-edited.png', full_page=True)
        # Write to SIM-1001 only? untick 2nd unit in Unit names
        await pg.click('button[role=tab]:text-is("UNIT NAMES")'); await pg.wait_for_timeout(200)
        await pg.click('button[aria-label="Send settings to SIM-1002"]')
        await pg.click('button[role=tab]:text-is("SETTINGS")'); await pg.wait_for_timeout(200)
        wb = pg.locator('button:has-text("WRITE TO 1 OF 2")'); ok(await wb.count() == 1, 'write button says 1 of 2')
        await wb.click()
        await pg.wait_for_timeout(1200); await pg.screenshot(path='shots/3-writing.png')
        await pg.wait_for_timeout(4000)
        await pg.screenshot(path='shots/4-written.png', full_page=True)
        s = state(); u = [v for v in s['vrx']['vrxs'] if v['uuid'] == 'SN1001'][0]; u2 = [v for v in s['vrx']['vrxs'] if v['uuid'] == 'SN1002'][0]
        ok(u['hphMode'] == 'STEREO' and u['squelch'] == 'HIGH' and u['gainBoost'] is True and u['voicePromptsEnable'] == 'LEFT' and u['led'] == 'DIM', 'settings on unit 1')
        ok(u['delayMs'] == '120' and u['encryption'] == '0BEEF5', 'delay and encryption on unit 1: %s %s' % (u.get('delayMs'), u.get('encryption')))
        ok(u['channels'][2]['channelEnable'] and u['channels'][1]['frequency'] == 216500, 'channels on unit 1')
        ok(u2['hphMode'] == 'MONO', 'unit 2 untouched')
        txt = await pg.inner_text('body')
        ok('Last written at' in txt, 'page shows written: ' + txt[txt.find('VRX SETTINGS'):][:120].replace('\n', ' | '))
        # rename unit 2
        await pg.click('button[role=tab]:text-is("UNIT NAMES")'); await pg.wait_for_timeout(200)
        n = pg.locator('input[aria-label="Name of VRX serial 1002"]'); await n.fill('BOOM_OP'); await n.press('Tab')
        await pg.click('button:text-is("SAVE NAME") >> nth=1'); await pg.wait_for_timeout(4500)
        await pg.screenshot(path='shots/5-names.png', full_page=True)
        ok([v for v in state()['vrx']['vrxs'] if v['uuid'] == 'SN1002'][0]['unitName'] == 'BOOM_OP', 'rename unit 2')
        # compare tab
        await pg.click('button[role=tab]:text-is("COMPARE")'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/6-compare.png', full_page=True)
        # presets: store current
        await pg.click('button[role=tab]:text-is("SETTINGS")'); await pg.wait_for_timeout(200)
        await pg.click('button:text-is("PRESETS")'); await pg.wait_for_timeout(200)
        await pg.click('button:has-text("+ New preset")')
        await pg.fill('input[maxlength="20"]', 'Stage Right'); await pg.click('button:text-is("Store current")'); await pg.wait_for_timeout(800)
        await pg.screenshot(path='shots/7-presets.png')
        ps = state()['presets']['presets']
        ok(len(ps) == 1 and ps[0]['name'] == 'Stage Right' and ps[0]['vrx'].get('hphMode') == 'STEREO', 'preset stored: ' + json.dumps(ps)[:200])
        ok('pilotTone' not in json.dumps(ps), 'preset has no unsupported keys')
        ok(not errs, 'no page errors ' + str(errs[:3]))
        await b.close()
asyncio.run(main())
print('FAILED: %d' % len(fails) if fails else 'ALL PASS')
