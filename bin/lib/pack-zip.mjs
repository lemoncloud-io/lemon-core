/** Deterministic ZIP32 archives using only Node built-ins. No host zip tool needed. */
import { open, readFile, mkdir, writeFile, symlink, chmod, lstat } from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const table = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
});
export function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
export function safeRelative(name) {
    if (
        typeof name !== 'string' ||
        !name ||
        name.includes('\\') ||
        /[\x00-\x1f\x7f]/.test(name) ||
        path.posix.isAbsolute(name) ||
        /^[A-Za-z]:/.test(name) ||
        name.split('/').some(p => !p || p === '.' || p === '..')
    ) {
        throw new Error(`Unsafe relative path: ${JSON.stringify(name)}`);
    }
    return name;
}
function safeLink(name, target) {
    if (
        !target ||
        target.includes('\\') ||
        /[\x00-\x1f\x7f]/.test(target) ||
        path.posix.isAbsolute(target) ||
        /^[A-Za-z]:/.test(target)
    ) {
        throw new Error(`Unsafe symlink: ${name}`);
    }
    safeRelative(path.posix.normalize(path.posix.join(path.posix.dirname(name), target)));
}

export async function writeZip(
    destination,
    entries,
    { maxZipBytes = 50 * 1024 ** 2, maxUncompressedBytes = 250 * 1024 ** 2 } = {},
) {
    if (entries.length > 65535) throw new Error('ZIP32 file count limit exceeded');
    const ordered = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    const seen = new Set();
    const central = [];
    const files = [];
    let offset = 0,
        total = 0;
    const handle = await open(destination, 'wx', 0o644);
    try {
        for (const entry of ordered) {
            safeRelative(entry.path);
            if (seen.has(entry.path)) throw new Error(`Duplicate ZIP path: ${entry.path}`);
            seen.add(entry.path);
            const name = Buffer.from(entry.path);
            if (name.length > 65535) throw new Error('ZIP filename limit exceeded');
            if (entry.link !== undefined) safeLink(entry.path, entry.link);
            const data = entry.link !== undefined ? Buffer.from(entry.link) : await readFile(entry.source);
            total += data.length;
            if (total > maxUncompressedBytes)
                throw new Error(`Uncompressed size exceeds ${maxUncompressedBytes} bytes`);
            const compressed = deflateRawSync(data, { level: 9 });
            const crc = crc32(data);
            const mode = entry.link !== undefined ? 0o120777 : entry.executable ? 0o100755 : 0o100644;
            const local = Buffer.alloc(30);
            local.writeUInt32LE(0x04034b50, 0);
            local.writeUInt16LE(20, 4);
            local.writeUInt16LE(0x800, 6); // UTF-8, no data descriptor
            local.writeUInt16LE(8, 8);
            local.writeUInt16LE(0x21, 12); // 1980-01-01 00:00:00, independent of local TZ
            local.writeUInt32LE(crc, 14);
            local.writeUInt32LE(compressed.length, 18);
            local.writeUInt32LE(data.length, 22);
            local.writeUInt16LE(name.length, 26);
            const record = Buffer.alloc(46);
            record.writeUInt32LE(0x02014b50, 0);
            record.writeUInt16LE(0x0314, 4); // Unix, ZIP 2.0
            local.copy(record, 6, 4, 30);
            record.writeUInt32LE((mode << 16) >>> 0, 38);
            record.writeUInt32LE(offset, 42);
            central.push(record, name);
            await handle.writeFile(Buffer.concat([local, name, compressed]));
            offset += local.length + name.length + compressed.length;
            if (offset > maxZipBytes) throw new Error(`ZIP size exceeds ${maxZipBytes} bytes`);
            files.push({
                path: entry.path,
                bytes: data.length,
                sha256: sha256(data),
                mode: mode.toString(8),
                ...(entry.link !== undefined ? { symlink: entry.link } : {}),
            });
        }
        const centralBytes = Buffer.concat(central);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(ordered.length, 8);
        end.writeUInt16LE(ordered.length, 10);
        end.writeUInt32LE(centralBytes.length, 12);
        end.writeUInt32LE(offset, 16);
        const bytes = offset + centralBytes.length + end.length;
        if (bytes > maxZipBytes) throw new Error(`ZIP size exceeds ${maxZipBytes} bytes`);
        await handle.writeFile(Buffer.concat([centralBytes, end]));
        return { files, bytes, uncompressedBytes: total };
    } finally {
        await handle.close();
    }
}

/** Extract and verify our ZIP against its inventory, before loading the actual archived handler. */
export async function extractZip(archive, destination, files) {
    const zip = await readFile(archive);
    const pendingLinks = [];
    let offset = 0;
    await mkdir(destination, { recursive: true, mode: 0o755 });
    for (const file of files) {
        if (offset + 30 > zip.length || zip.readUInt32LE(offset) !== 0x04034b50)
            throw new Error('Invalid ZIP local record');
        if (zip.readUInt16LE(offset + 6) !== 0x800 || zip.readUInt16LE(offset + 8) !== 8)
            throw new Error('Unsupported ZIP encoding');
        const size = zip.readUInt32LE(offset + 18);
        const nameLength = zip.readUInt16LE(offset + 26);
        const extraLength = zip.readUInt16LE(offset + 28);
        const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
        safeRelative(name);
        if (name !== file.path) throw new Error('ZIP inventory path mismatch');
        const start = offset + 30 + nameLength + extraLength;
        if (start + size > zip.length) throw new Error('Truncated ZIP');
        const data = inflateRawSync(zip.subarray(start, start + size), { maxOutputLength: Math.max(1, file.bytes) });
        if (data.length !== file.bytes || sha256(data) !== file.sha256 || crc32(data) !== zip.readUInt32LE(offset + 14))
            throw new Error(`ZIP integrity mismatch: ${name}`);
        const target = path.join(destination, name);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
        if (file.symlink !== undefined) {
            const link = data.toString();
            safeLink(name, link);
            pendingLinks.push([link, target]);
        } else {
            await writeFile(target, data, { flag: 'wx', mode: Number.parseInt(file.mode, 8) & 0o777 });
            await chmod(target, Number.parseInt(file.mode, 8) & 0o777);
        }
        offset = start + size;
    }
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP inventory count mismatch');
    for (const [link, target] of pendingLinks) {
        // Creating links last ensures an archive can never redirect file writes.
        try {
            await lstat(target);
            throw new Error('ZIP link collides with a directory');
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
        }
        await symlink(link, target);
    }
}
