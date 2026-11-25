package com.vertexhash.app;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.zip.InflaterInputStream;

/**
 * Applies a patch made by tools/release.py: a bsdiff patch ("VXP1") whose three blocks are deflate packed,
 * so no extra library is needed. old file + patch = the new file, byte for byte (the caller checks the hash).
 */
final class VxPatch {
    private static final long MAX = 100L * 1024 * 1024;

    private VxPatch() {}

    static void apply(File oldFile, File patchFile, File outFile) throws IOException {
        byte[] old = readAll(oldFile);
        long newSize;
        byte[][] blocks = new byte[3][];
        DataInputStream in = new DataInputStream(new BufferedInputStream(new FileInputStream(patchFile)));
        try {
            byte[] magic = new byte[4];
            in.readFully(magic);
            if (magic[0] != 'V' || magic[1] != 'X' || magic[2] != 'P' || magic[3] != '1') throw new IOException("bad patch");
            newSize = in.readLong();
            if (newSize < 0 || newSize > MAX) throw new IOException("bad size");
            for (int i = 0; i < 3; i++) {
                int len = in.readInt();
                if (len < 0 || len > MAX) throw new IOException("bad block");
                blocks[i] = new byte[len];
                in.readFully(blocks[i]);
            }
        } finally {
            in.close();
        }
        DataInputStream ctrl = new DataInputStream(new InflaterInputStream(new ByteArrayInputStream(blocks[0])));
        DataInputStream diff = new DataInputStream(new InflaterInputStream(new ByteArrayInputStream(blocks[1])));
        DataInputStream extra = new DataInputStream(new InflaterInputStream(new ByteArrayInputStream(blocks[2])));
        byte[] out = new byte[(int) newSize];
        byte[] b8 = new byte[8];
        long oldPos = 0;
        long newPos = 0;
        while (newPos < newSize) {
            long[] c = new long[3];
            for (int i = 0; i < 3; i++) {
                ctrl.readFully(b8);
                c[i] = offtin(b8);
            }
            if (c[0] < 0 || newPos + c[0] > newSize) throw new IOException("corrupt patch");
            diff.readFully(out, (int) newPos, (int) c[0]);
            for (int i = 0; i < c[0]; i++) {
                long p = oldPos + i;
                if (p >= 0 && p < old.length) out[(int) (newPos + i)] += old[(int) p];
            }
            newPos += c[0];
            oldPos += c[0];
            if (c[1] < 0 || newPos + c[1] > newSize) throw new IOException("corrupt patch");
            extra.readFully(out, (int) newPos, (int) c[1]);
            newPos += c[1];
            oldPos += c[2];
        }
        FileOutputStream fo = new FileOutputStream(outFile);
        try {
            fo.write(out);
        } finally {
            fo.close();
        }
    }

    // bsdiff numbers: 8 bytes, little endian, sign in the top bit.
    private static long offtin(byte[] b) {
        long y = b[7] & 0x7F;
        for (int i = 6; i >= 0; i--) y = y * 256 + (b[i] & 0xFF);
        return (b[7] & 0x80) != 0 ? -y : y;
    }

    private static byte[] readAll(File f) throws IOException {
        if (f.length() > MAX) throw new IOException("too big");
        byte[] b = new byte[(int) f.length()];
        DataInputStream in = new DataInputStream(new BufferedInputStream(new FileInputStream(f)));
        try {
            in.readFully(b);
        } finally {
            in.close();
        }
        return b;
    }
}
