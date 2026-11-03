import { readFile, mkdtemp, rm, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { extractZip, safeRelative, sha256 } from './pack-zip.mjs';

export function validateHandler(handler) {
    if (
        !handler ||
        typeof handler.file !== 'string' ||
        typeof handler.export !== 'string' ||
        !/^[\w$]+$/.test(handler.export)
    )
        throw new Error('handler requires file and export');
    safeRelative(handler.file);
    if (!/\.(?:c?js|mjs)$/.test(handler.file))
        throw new Error('Handler must be compiled JavaScript (.js, .cjs or .mjs)');
    return { file: handler.file, export: handler.export };
}
export async function prepareSource({ root, artifact, handler }) {
    if (Boolean(root) === Boolean(artifact)) throw new Error('Specify exactly one of root or artifact');
    if (root) {
        const directory = await realpath(root);
        if (!(await stat(directory)).isDirectory()) throw new Error('root must be a directory');
        return {
            root: directory,
            handler: validateHandler(handler ?? { file: 'handler.js', export: 'lambda' }),
            source: { type: 'root', verified: false },
            cleanup: async () => {},
        };
    }
    const directory = path.resolve(artifact);
    const manifestBytes = await readFile(path.join(directory, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes);
    const archive = manifest.archive;
    if (
        manifest.schemaVersion !== 1 ||
        !archive ||
        !Array.isArray(manifest.files) ||
        !manifest.files.length ||
        archive.fileCount !== manifest.files.length
    )
        throw new Error('Invalid pack manifest schema or inventory');
    safeRelative(archive.file);
    if (archive.file.includes('/') || !/^[a-f0-9]{64}$/.test(archive.sha256))
        throw new Error('Invalid archive identity');
    if (!Number.isSafeInteger(archive.bytes) || archive.bytes < 1 || archive.bytes > 50 * 1024 ** 2)
        throw new Error('Invalid archive size (maximum 50 MiB)');
    let total = 0;
    const seen = new Set();
    for (const file of manifest.files) {
        safeRelative(file.path);
        if (
            seen.has(file.path) ||
            !Number.isSafeInteger(file.bytes) ||
            file.bytes < 0 ||
            !/^[a-f0-9]{64}$/.test(file.sha256) ||
            !['100644', '100755', '120777'].includes(file.mode)
        )
            throw new Error('Invalid file inventory');
        if ((file.mode === '120777') !== (typeof file.symlink === 'string'))
            throw new Error('Invalid symlink inventory');
        if (
            file.symlink !== undefined &&
            (Buffer.byteLength(file.symlink) !== file.bytes || sha256(file.symlink) !== file.sha256)
        )
            throw new Error('Symlink identity mismatch');
        seen.add(file.path);
        total += file.bytes;
    }
    if (total !== archive.uncompressedBytes || total > 250 * 1024 ** 2)
        throw new Error('Invalid uncompressed inventory size (maximum 250 MiB)');
    const selectedHandler = validateHandler(handler ?? manifest.validation?.handler);
    if (!seen.has(selectedHandler.file)) throw new Error('Handler missing from archive inventory');
    const zipPath = path.join(directory, archive.file);
    if ((await stat(zipPath)).size !== archive.bytes || sha256(await readFile(zipPath)) !== archive.sha256)
        throw new Error('Archive SHA-256 or size mismatch');
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'lambda-local-'));
    try {
        const extracted = path.join(temporary, 'task');
        await extractZip(zipPath, extracted, manifest.files);
        return {
            root: extracted,
            handler: selectedHandler,
            source: {
                type: 'artifact',
                verified: true,
                manifestSha256: sha256(manifestBytes),
                archiveSha256: archive.sha256,
                fileCount: manifest.files.length,
                runtime: manifest.runtime,
                architecture: manifest.architecture,
            },
            cleanup: () => rm(temporary, { recursive: true, force: true }),
        };
    } catch (error) {
        await rm(temporary, { recursive: true, force: true });
        throw error;
    }
}
