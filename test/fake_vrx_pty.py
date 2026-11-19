# Fake VRX on a pseudo-terminal, to test the real serial path (stty + cat) of server.js.
import os, pty, tty, struct, sys, time, select
m, s = pty.openpty(); name = os.ttyname(s)
open(sys.argv[1], 'w').write(name)
tty.setraw(m)
def frame(cmd, p, addr=0):
    b = bytes([len(p) & 255, len(p) >> 8, addr, cmd]) + p
    return bytes([0xaa, sum(b) & 255]) + b
p = bytearray(64 + 80)
struct.pack_into('<I', p, 0, 0x11223344); p[8:16] = b'PTY-7777'; struct.pack_into('<I', p, 24, 7777)
p[28] = 5; p[33] = 1; p[34] = 1; p[35] = 1; p[36] = 3; p[37] = 1; p[39] = 1; p[46] = 10; p[49] = 0x28; p[51] = 1
struct.pack_into('<II', p, 52, 215000, 217000)
for i in range(10): struct.pack_into('<I', p, 64 + 8 * i, 215100 + 100 * i)
buf = b''; writes = 0
while True:
    r, _, _ = select.select([m], [], [], 30)
    if not r: break
    try: d = os.read(m, 4096)
    except OSError: break
    buf += d
    while True:
        i = buf.find(b'\xaa')
        if i < 0 or len(buf) - i < 6: break
        n = buf[i + 2] | buf[i + 3] << 8
        if len(buf) - i < 6 + n: break
        f = buf[i:i + 6 + n]; buf = buf[i + 6 + n:]
        if sum(f[2:]) & 255 != f[1]: print('bad ck'); continue
        pl = f[6:]
        if f[5] == 0x80 and len(pl) == 4:
            os.write(m, b'\x1b[0m\r\r' + frame(0x80, bytes(p), 0xff) + b'\r\r' + frame(0x20, b'VRX 1.23 sn7777\0'))
        elif f[5] == 0x80 and len(pl) == len(p):
            hs = sum(struct.unpack('<16I', pl[:64])) & 0xffffffff
            print('write; header checksum ok' if hs == 0 else 'write; HEADER CHECKSUM BAD', flush=True)
            p = bytearray(pl); writes += 1
            for k in range(10): p[64 + 8 * k + 4] = 0
