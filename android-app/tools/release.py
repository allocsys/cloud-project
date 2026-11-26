#!/usr/bin/env python3
"""Makes the files of one app release (used by .github/workflows/android.yml, also runnable by hand).

  release.py make --code N [--name 1.0.X] --apk SIGNED.apk --out DIR [--prev-apk OLD.apk --prev-code M]
    DIR/vertexhash-N.apk   the signed app
    DIR/patch-M-N.vxp      the difference from the previous release (only when it is worth it and checked)
    DIR/manifest.json      what the site's /api/app-update reads (hashes, sizes)

A patch is bsdiff made by the `bsdiff` tool, then repacked ("VXP1": three deflate blocks) so the phone needs no extra library.
It is applied again here and must give the new file exactly, or it is left out (the phone then downloads the whole file).
"""
import argparse
import bz2
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def offtin(b):
    y = b[7] & 0x7F
    for i in range(6, -1, -1):
        y = y * 256 + b[i]
    return -y if b[7] & 0x80 else y


def convert(d):
    """BSDIFF40 bytes -> VXP1 bytes."""
    if d[:8] != b'BSDIFF40':
        raise ValueError('not a bsdiff patch')
    ctrl_len, data_len, new_size = offtin(d[8:16]), offtin(d[16:24]), offtin(d[24:32])
    blocks = (
        bz2.decompress(d[32:32 + ctrl_len]),
        bz2.decompress(d[32 + ctrl_len:32 + ctrl_len + data_len]),
        bz2.decompress(d[32 + ctrl_len + data_len:]),
    )
    out = b'VXP1' + struct.pack('>q', new_size)
    for blk in blocks:
        z = zlib.compress(blk, 9)
        out += struct.pack('>I', len(z)) + z
    return out


def apply_patch(old, patch):
    """The same steps as VxPatch.java, to check a patch before it is published."""
    if patch[:4] != b'VXP1':
        raise ValueError('bad magic')
    new_size = struct.unpack('>q', patch[4:12])[0]
    pos = 12
    blocks = []
    for _ in range(3):
        n = struct.unpack('>I', patch[pos:pos + 4])[0]
        pos += 4
        blocks.append(zlib.decompress(patch[pos:pos + n]))
        pos += n
    ctrl, diff, extra = blocks
    new = bytearray(new_size)
    old_pos = new_pos = cp = dp = ep = 0
    while new_pos < new_size:
        c = [offtin(ctrl[cp + 8 * i:cp + 8 * i + 8]) for i in range(3)]
        cp += 24
        n = c[0]
        if n < 0 or new_pos + n > new_size:
            raise ValueError('corrupt')
        chunk = bytearray(diff[dp:dp + n])
        dp += n
        for i in range(n):
            p = old_pos + i
            if 0 <= p < len(old):
                chunk[i] = (chunk[i] + old[p]) & 0xFF
        new[new_pos:new_pos + n] = chunk
        new_pos += n
        old_pos += n
        n = c[1]
        if n < 0 or new_pos + n > new_size:
            raise ValueError('corrupt')
        new[new_pos:new_pos + n] = extra[ep:ep + n]
        ep += n
        new_pos += n
        old_pos += c[2]
    return bytes(new)


def make_patch(old_apk, new_apk, out_path):
    """Returns True when a checked patch was written."""
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, 'p.bsdiff')
        subprocess.run(['bsdiff', old_apk, new_apk, raw], check=True)
        with open(raw, 'rb') as f:
            vxp = convert(f.read())
    with open(old_apk, 'rb') as f:
        old = f.read()
    with open(new_apk, 'rb') as f:
        new = f.read()
    if apply_patch(old, vxp) != new:
        print('patch check failed, no patch', file=sys.stderr)
        return False
    if len(vxp) > len(new) * 0.8:
        print('patch not smaller enough, no patch', file=sys.stderr)
        return False
    with open(out_path, 'wb') as f:
        f.write(vxp)
    return True


def make(args):
    code = args.code
    os.makedirs(args.out, exist_ok=True)
    apk = os.path.join(args.out, f'vertexhash-{code}.apk')
    shutil.copyfile(args.apk, apk)
    man = {
        'versionCode': code,
        'versionName': args.name or f'1.0.{code}',
        'apk': {'name': os.path.basename(apk), 'size': os.path.getsize(apk), 'sha256': sha256(apk)},
    }
    if args.prev_apk and args.prev_code and 0 < args.prev_code < code:
        name = f'patch-{args.prev_code}-{code}.vxp'
        path = os.path.join(args.out, name)
        try:
            if make_patch(args.prev_apk, apk, path):
                man['patch'] = {'from': args.prev_code, 'name': name, 'size': os.path.getsize(path), 'sha256': sha256(path), 'base': sha256(args.prev_apk)}
        except Exception as e:  # a failed patch must never stop the release
            print(f'no patch: {e}', file=sys.stderr)
            if os.path.exists(path):
                os.remove(path)
    with open(os.path.join(args.out, 'manifest.json'), 'w') as f:
        json.dump(man, f, indent=2)
        f.write('\n')
    print(json.dumps(man, indent=2))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    m = sub.add_parser('make')
    m.add_argument('--code', type=int, required=True)
    m.add_argument('--name')
    m.add_argument('--apk', required=True)
    m.add_argument('--out', required=True)
    m.add_argument('--prev-apk')
    m.add_argument('--prev-code', type=int)
    m.set_defaults(fn=make)
    a = ap.parse_args()
    a.fn(a)
