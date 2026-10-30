/**
 * `bin/lib/pack.spec.mjs` (lemon-core)
 * - offline tests of pack-core.mjs / pack-zip.mjs (`lemon-lambda-pack`): temp dirs under `os.tmpdir()`, stubbed clients/children, no AWS, no network.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/pack.test.mjs` (node:test -> vitest; every case kept).
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseArgs, validateConfig, copySource, validateLock, collectFiles, pack, runCommand } from './pack-core.mjs';
import { sha256, crc32, safeRelative, writeZip, extractZip } from './pack-zip.mjs';

//* v5 B19: node:test had no per-test deadline; the process cases (fork/spawn) need more than 5 s on a busy host.
vi.setConfig({ testTimeout: 60_000 });

const imageId = `sha256:${'a'.repeat(64)}`;
const config = () => ({
    schemaVersion: 1,
    runtime: 'nodejs24.x',
    architecture: 'x86_64',
    image: 'public.ecr.aws/lambda/nodejs:24',
    sourcePaths: ['package.json', 'package-lock.json', 'handler.js', 'src', 'data'],
    runtimePaths: ['handler.js', 'dist', 'data'],
    handler: { file: 'handler.js', export: 'lambda' },
    buildScript: 'build',
    outputRoot: '.artifacts',
});
async function temp(t) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pack-test-'));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    return dir;
}
async function put(root, name, text = name) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text);
}
async function fixture(t) {
    const root = await temp(t);
    const pkg = {
        name: 'fixture',
        version: '1.0.0',
        scripts: { build: 'tsc', postinstall: 'do-not-run-in-production' },
        dependencies: { runtime: '1.0.0', 'required-peer': '1.0.0' },
        devDependencies: { typescript: '1.0.0' },
        allowScripts: { runtime: true },
    };
    const lock = {
        lockfileVersion: 3,
        packages: {
            '': {
                name: pkg.name,
                version: pkg.version,
                dependencies: pkg.dependencies,
                devDependencies: pkg.devDependencies,
            },
            'node_modules/runtime': {
                version: '1.0.0',
                peerDependencies: { typescript: '*', 'required-peer': '*' },
                peerDependenciesMeta: { typescript: { optional: true } },
            },
            'node_modules/typescript': { version: '1.0.0', devOptional: true },
            'node_modules/required-peer': { version: '1.0.0' },
        },
    };
    await put(root, 'package.json', JSON.stringify(pkg));
    await put(root, 'package-lock.json', JSON.stringify(lock));
    await put(root, 'pack.config.json', JSON.stringify(config()));
    await put(root, 'handler.js', 'exports.lambda = async () => "ok";');
    for (const file of [
        'src/index.ts',
        'data/input.json',
        'node_modules/HOST_SENTINEL',
        'dist/HOST_SENTINEL',
        '.env',
        '.npmrc',
        '.aws/credentials',
        'env/config.js',
        'src/.env.local',
        'data/secret.key',
        'src/secrets.json',
        'data/service-credentials.json',
    ])
        await put(root, file);
    return { root, pkg, lock };
}
function fakeDocker(root, { fail, wrongArchitecture = false } = {}) {
    const calls = [];
    const run = async (command, args, opts) => {
        calls.push({ command, args, opts });
        if (command === 'git') return args[0] === 'rev-parse' ? `${'b'.repeat(40)}\n` : ' M package.json\n';
        assert.equal(command, 'docker');
        if (args[0] === 'image')
            return JSON.stringify([
                {
                    Id: imageId,
                    Architecture: wrongArchitecture ? 'arm64' : 'amd64',
                    Os: 'linux',
                    RepoDigests: [`image@${imageId}`],
                },
            ]);
        if (args[0] === 'rm' || args[0] === 'pull') return '';
        assert.equal(args[0], 'run');
        assert.ok(args.includes(imageId));
        const mount = args[args.indexOf('--mount') + 1].match(/src=(.*),dst=/)[1];
        assert.notEqual(mount, root);
        const script = args.at(-1);
        if (script.includes('PACK_HANDLER_OK')) {
            if (fail === 'smoke') throw new Error('fixture smoke failed');
            assert.ok(args.includes('--network=none'));
            assert.ok(args.includes('--read-only'));
            assert.ok(args.includes('AWS_LAMBDA_FUNCTION_NAME=pack-smoke'));
            assert.ok(args.includes('AWS_EXECUTION_ENV=AWS_Lambda_nodejs24.x'));
            assert.ok((await readFile(path.join(mount, 'handler.js'), 'utf8')).includes('lambda'));
            assert.ok(
                (await readFile(path.join(mount, 'node_modules/runtime/src/index.js'), 'utf8')).includes('runtime'),
            );
            return 'PACK_HANDLER_OK\n';
        }
        if (script.includes('PACK_RUNTIME='))
            return 'PACK_RUNTIME={"node":"v24.0.0","architecture":"x64","osRelease":"fixture"}\n';
        if (script.includes('--include=dev')) {
            if (fail === 'build') throw new Error('fixture build failed');
            assert.equal(await readFile(path.join(root, 'dist/HOST_SENTINEL'), 'utf8'), 'dist/HOST_SENTINEL');
            assert.ok(!(await readdir(mount)).includes('env'));
            for (const file of [
                'dist/index.js',
                'dist/index.js.map',
                'dist/index.d.ts',
                'dist/index.spec.js',
                'dist/tests/fixture.js',
                'dist/tsconfig.tsbuildinfo',
            ])
                await put(mount, file);
            return '';
        }
        assert.match(script, /npm ci --omit=dev/);
        if (fail === 'install') throw new Error('fixture install failed');
        const installedPackage = JSON.parse(await readFile(path.join(mount, 'package.json'), 'utf8'));
        const installedLock = JSON.parse(await readFile(path.join(mount, 'package-lock.json'), 'utf8'));
        assert.equal(installedPackage.scripts, undefined);
        assert.equal(installedPackage.devDependencies, undefined);
        assert.deepEqual(installedPackage.allowScripts, { runtime: true });
        assert.equal(installedLock.packages[''].devDependencies, undefined);
        assert.equal(installedLock.packages['node_modules/typescript'].devOptional, true); // resolved graph is not pruned
        assert.deepEqual(installedLock.packages['node_modules/runtime'].peerDependencies, {
            typescript: '*',
            'required-peer': '*',
        });
        assert.deepEqual(installedLock.packages['node_modules/runtime'].peerDependenciesMeta, {
            typescript: { optional: true },
        });
        for (const file of [
            'node_modules/runtime/src/index.js',
            'node_modules/runtime/types.d.ts',
            'node_modules/required-peer/index.js',
            'node_modules/.package-lock.json',
        ])
            await put(mount, file);
        return '';
    };
    return { run, calls };
}

test('strict CLI and explicit runtime/architecture selection', () => {
    assert.deepEqual(parseArgs(['--architecture=arm64', '--output', 'out']), { architecture: 'arm64', output: 'out' });
    for (const args of [
        ['--oops'],
        ['--runtime'],
        ['--output', '--help'],
        ['positional'],
        ['--output=a', '--output=b'],
    ])
        assert.throws(() => parseArgs(args));
    assert.equal(validateConfig(config(), { architecture: 'arm64' }).architecture, 'arm64');
    assert.throws(() => validateConfig(config(), { runtime: 'nodejs22.x' }), /runtime/);
    assert.throws(() => validateConfig(config(), { architecture: 'amd64' }), /architecture/);
    assert.throws(() => validateConfig({ ...config(), sourcePaths: ['../secret'] }), /Unsafe/);
    assert.throws(() => validateConfig({ ...config(), runtimePaths: ['handler.js', 'env'] }), /Forbidden/);
});

test('snapshot copies only allowlisted sources and rejects source symlinks', async t => {
    const { root } = await fixture(t);
    const destination = await temp(t);
    await copySource(root, destination, config().sourcePaths);
    const files = (await collectFiles(destination)).map(file => file.path);
    assert.ok(files.includes('src/index.ts'));
    assert.ok(files.includes('data/input.json'));
    assert.ok(!files.some(file => /HOST_SENTINEL|secret|\.env|\.npmrc|credentials/.test(file)));
    await symlink('/etc', path.join(root, 'parent-link'));
    await assert.rejects(copySource(root, await temp(t), ['parent-link/passwd']), /Source path escapes/);
    await symlink('/etc/passwd', path.join(root, 'src/escape'));
    await assert.rejects(copySource(root, await temp(t), config().sourcePaths), /Source (symlink|path escapes)/);
});

test('lock mismatch and local dependency fail before container execution', async t => {
    const { root, pkg, lock } = await fixture(t);
    assert.doesNotThrow(() => validateLock(pkg, lock));
    assert.throws(() => validateLock({ ...pkg, dependencies: {} }, lock), /root mismatch/);
    assert.throws(
        () => validateLock(pkg, { ...lock, packages: { ...lock.packages, local: { link: true } } }),
        /Local dependency/,
    );
    await put(root, 'package.json', JSON.stringify({ ...pkg, dependencies: {} }));
    let calls = 0;
    await assert.rejects(
        pack({
            cwd: root,
            run: async () => {
                calls++;
            },
            log: () => {},
        }),
        /root mismatch/,
    );
    assert.equal(calls, 0);
});

test('ZIP bytes are deterministic, use Linux modes and round-trip content/safe links', async t => {
    const root = await temp(t);
    await put(root, 'b.js', 'exports.answer=42');
    await put(root, 'a.txt', 'same bytes');
    const entries = [
        { path: 'b.js', source: path.join(root, 'b.js'), executable: true },
        { path: 'a.txt', source: path.join(root, 'a.txt') },
        { path: 'nested/link', link: '../a.txt' },
    ];
    const one = await writeZip(path.join(root, 'one.zip'), entries);
    await writeZip(path.join(root, 'two.zip'), [...entries].reverse());
    const bytes = await readFile(path.join(root, 'one.zip'));
    assert.equal(sha256(bytes), sha256(await readFile(path.join(root, 'two.zip'))));
    assert.equal(bytes.readUInt16LE(10), 0);
    assert.equal(bytes.readUInt16LE(12), 0x21);
    assert.deepEqual(
        one.files.map(file => [file.path, file.mode]),
        [
            ['a.txt', '100644'],
            ['b.js', '100755'],
            ['nested/link', '120777'],
        ],
    );
    const centralOffset = bytes.readUInt32LE(bytes.length - 6);
    assert.equal(bytes.readUInt32LE(centralOffset), 0x02014b50);
    assert.equal(bytes.readUInt16LE(centralOffset + 4), 0x0314);
    assert.equal(bytes.readUInt32LE(centralOffset + 38) >>> 16, 0o100644);
    await extractZip(path.join(root, 'one.zip'), path.join(root, 'extracted'), one.files);
    assert.equal(await readFile(path.join(root, 'extracted/nested/link'), 'utf8'), 'same bytes');
    assert.equal((await lstat(path.join(root, 'extracted/b.js'))).mode & 0o777, 0o755);
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('ZIP refuses traversal, escaping links, duplicate paths, corruption and size excess', async t => {
    const root = await temp(t);
    for (const name of ['../oops', '/oops', 'a/../b', 'a\\b', 'C:/oops', 'a//b'])
        assert.throws(() => safeRelative(name));
    await put(root, 'entry', 'test');
    const entry = { path: 'entry', source: path.join(root, 'entry') };
    await assert.rejects(writeZip(path.join(root, 'link.zip'), [{ path: 'a', link: '../outside' }]), /Unsafe/);
    await assert.rejects(writeZip(path.join(root, 'duplicate.zip'), [entry, entry]), /Duplicate/);
    await assert.rejects(writeZip(path.join(root, 'large.zip'), [entry], { maxUncompressedBytes: 1 }), /Uncompressed/);
    await assert.rejects(writeZip(path.join(root, 'ziplimit.zip'), [entry], { maxZipBytes: 1 }), /ZIP size/);
    const archive = await writeZip(path.join(root, 'good.zip'), [entry]);
    await assert.rejects(
        extractZip(path.join(root, 'good.zip'), path.join(root, 'extract'), [{ ...archive.files[0], sha256: 'bad' }]),
        /integrity/,
    );
    await symlink('/etc/passwd', path.join(root, 'escape'));
    await assert.rejects(collectFiles(root), /Symlink escapes/);
});

test('full fixture flow publishes only verified runtime files and external evidence', async t => {
    const { root, pkg, lock } = await fixture(t);
    const beforePackage = await readFile(path.join(root, 'package.json'));
    const beforeLock = await readFile(path.join(root, 'package-lock.json'));
    const docker = fakeDocker(root);
    const result = await pack({ cwd: root, options: { output: 'result' }, run: docker.run, log: () => {} });
    assert.deepEqual((await readdir(result.output)).sort(), ['lambda.zip', 'manifest.json']);
    const names = result.manifest.files.map(file => file.path);
    assert.ok(names.includes('handler.js'));
    assert.ok(names.includes('dist/index.js.map'));
    assert.ok(names.includes('data/input.json'));
    assert.ok(names.includes('node_modules/runtime/src/index.js'));
    assert.ok(names.includes('node_modules/runtime/types.d.ts'));
    assert.ok(names.includes('node_modules/required-peer/index.js'));
    assert.ok(
        !names.some(name =>
            /typescript|\.spec\.|dist\/tests|dist\/index.d.ts|tsbuildinfo|package-lock|HOST_SENTINEL/.test(name),
        ),
    );
    assert.equal(result.manifest.image.id, imageId);
    assert.deepEqual(result.manifest.packer, {
        node: process.version,
        zlib: process.versions.zlib,
        platform: process.platform,
        architecture: process.arch,
    });
    assert.equal(result.manifest.lockfileSha256, sha256(beforeLock));
    assert.equal(result.manifest.validation.handlerExport, 'passed');
    assert.ok(Number.isInteger(result.manifest.timingsMs.cleanup));
    assert.ok(result.manifest.timingsMs.total >= result.manifest.timingsMs.cleanup);
    assert.equal(result.manifest.source.dirty, true);
    assert.deepEqual(await readFile(path.join(root, 'package.json')), beforePackage);
    assert.deepEqual(await readFile(path.join(root, 'package-lock.json')), beforeLock);
    const extracted = await temp(t);
    await extractZip(path.join(result.output, 'lambda.zip'), extracted, result.manifest.files);
    const deployed = JSON.parse(await readFile(path.join(extracted, 'package.json'), 'utf8'));
    assert.equal(deployed.scripts, undefined);
    assert.equal(deployed.devDependencies, undefined);
    assert.deepEqual(deployed.dependencies, pkg.dependencies);
    assert.equal(lock.packages['node_modules/typescript'].devOptional, true);
    await assert.rejects(
        pack({ cwd: root, options: { output: 'result' }, run: docker.run, log: () => {} }),
        /already exists/,
    );
});

for (const phase of ['build', 'install', 'smoke'])
    test(`${phase} failure never publishes ZIP or manifest`, async t => {
        const { root } = await fixture(t);
        const docker = fakeDocker(root, { fail: phase });
        await assert.rejects(
            pack({ cwd: root, options: { output: 'result' }, run: docker.run, log: () => {} }),
            /fixture .* failed/,
        );
        assert.ok(!(await readdir(root)).includes('result'));
        assert.ok(!(await readdir(root)).some(name => name.startsWith('.pack-publish-')));
        assert.ok(docker.calls.some(call => call.command === 'docker' && call.args[0] === 'rm'));
    });

test('wrong image architecture never falls back to the host architecture', async t => {
    const { root } = await fixture(t);
    const docker = fakeDocker(root, { wrongArchitecture: true });
    await assert.rejects(pack({ cwd: root, run: docker.run, log: () => {} }), /does not match target/);
    assert.ok(!docker.calls.some(call => call.args[0] === 'run'));
});

test('real subprocess exit failures propagate', async () => {
    await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(7)'], { capture: true }), /exit 7/);
});

test('timeout kills a SIGTERM-ignoring child within a bounded grace period', async () => {
    const started = Date.now();
    await assert.rejects(
        runCommand(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),3000)"], {
            capture: true,
            timeout: 150,
            killGraceMs: 100,
        }),
        /timeout/,
    );
    assert.ok(Date.now() - started < 1500, 'timeout waited for natural exit instead of killing the child');
});
