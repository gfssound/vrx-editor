# VRX USB protocol — observed facts (2026-11-11, completed 2026-11-14)

Source: Zaxcom VRX Mac app 1.1.0 run with `VRX_SIMULATE=1 VRX_TRACE=1` (two simulated units, SIM-1001 with 10 channels and SIM-1002 with 8). Every fact below comes from the frames that trace printed while settings were changed one at a time and written. No Zaxcom code is used. Two captures (only the USB frame lines are kept, in `test/traces/`):
- Nov 11: `test/traces/trace-1.txt`, 11 writes.
- Nov 14: `test/traces/trace-2.txt`, 15 writes: every remaining menu option, plus delay and encryption typed in under full-screen control.

**Caveat:** the simulator is Zaxcom's own model of a unit. On Nov 14, two real VRXs (GFS02, GFS03) were running in VRX Editor 0.1.0 and reading fine. Real-unit writes are not yet checked here.

**Menus in Zaxcom's app fade in.** A screenshot taken right after opening a menu can miss items, which is why 0.1.0 thought some options didn't exist.

## Link
- USB CDC serial (`/dev/serial/by-id/usb-Zaxcom_VRX_*`, ttyACM on Linux; IOKit serial on the Mac).
- The unit also prints console text into the stream, e.g. `ESC[0m` and `\r\r`. Scan for the 0xAA sync byte and validate the checksum.
- The app polls each unit every 5 s.

## Frame
`AA | ck | len lo | len hi | addr | cmd | payload[len]`
- `ck` = sum of every byte from `len lo` to the end of the payload, mod 256. Verified on all frames.
- Host to unit uses addr `00`. The unit's settings reply uses addr `ff`; its info reply uses addr `00`.

| cmd | dir | payload |
|---|---|---|
| 0x80 | host→unit, len 4 | `44 33 22 11`: read-settings request |
| 0x80 | unit→host | settings struct (64 + 8×channels bytes; 144 for 10 channels, 128 for 8) |
| 0x80 | host→unit, full struct | write settings. The app re-reads about 1 s later and compares ("saved and confirmed") |
| 0x20 | unit→host, len 16 | ASCII info string, e.g. `VRX 9.99 sn1001\0`. Sent after every settings reply |

## Settings struct (little-endian)
All 26 writes in the two captures are byte-identical to what VRX Editor's encoder produces (`test/trace_test.js`).

| off | size | field | values (all seen written) |
|---|---|---|---|
| 0 | u32 | magic | 0x11223344 |
| 4 | u32 | header checksum | the 16 u32 words of bytes 0–63 sum to 0. Verified on all writes. The simulator's own replies don't satisfy this |
| 8 | char[16] | unit name | NUL-padded, 1–15 chars |
| 24 | u32 | serial | 1001 |
| 28 | u8 | struct version | 5 |
| 29 | u8 | boot announce | 0 off / 1 on |
| 30 | u16 | delay ms | 37 → 25 00, 300 → 2C 01 |
| 32 | u8 | headphone mode | 0 MONO, 1 STEREO, 2 BALANCED |
| 33 | u8 | LED | 0 OFF, 1 ON, 2 DIM |
| 34 | u8 | ? (probably charge) | 1, not in Zaxcom's app |
| 35 | u8 | A/B button | 0 OFF, 1 CHANNEL, 2 DELAY, 3 ANNOUNCE |
| 36 | u8 | * button | 0 OFF, 1 CHANNEL, 2 DELAY, 3 ANNOUNCE |
| 37 | u8 | ? (probably rfMode) | 1, not in Zaxcom's app |
| 38 | u8 | compander | 0 OFF, 1 COMPANDER1, 2 COMPANDER2 |
| 39 | u8 | battery type | 0 NIMH, 1 ALKALINE, 2 LITHIUM |
| 40 | u32 | encryption | 6 hex digits as a number: 1A2B3C → 3C 2B 1A 00 |
| 44 | u8 | bass boost | 0 Normal, 1 +3, 2 +6 |
| 45 | u8 | gain boost | 0 / 1 |
| 46 | u8 | channel count | 10 / 8 |
| 47 | u8 | ? | 0 |
| 48 | u8 | voice prompts | 0 OFF, 1 RIGHT, 2 LEFT, 3 CENTER (the menu order in Zaxcom's app: OFF, RIGHT, LEFT, CENTER) |
| 49 | u8 | squelch | 0x50 LOW, 0x28 MEDIUM, 0x0A HIGH |
| 50 | u8 | ? | 0 |
| 51 | u8 | reserved | 1 |
| 52 | u32 | band min, kHz | 215000 / 192000 |
| 56 | u32 | band max, kHz | 217000 / 216975 |
| 60 | u32 | reserved | 0 |
| 64+8n | 8 | channel n | u32 freq kHz, u8 channel number (1-based on write; reads return 0), u8 delay, u8 voting, u8 enable |

Zaxcom's VRX app has no pilot tone setting.

## Still open
- Bytes 34, 37, 47 and 50. Zaxcom's app never changes them; VRX Editor writes them back unchanged.
- A real unit's read checksum, and a confirmed real-unit write.
