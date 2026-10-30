/** Portable Lambda packaging core. Project policy belongs in pack.config.json. */
import {
    readFile,
    writeFile,
    mkdir,
    mkdtemp,
    cp,
    lstat,
    readdir,
    realpath,
    readlink,
    rm,
    rename,
    chmod,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { safeRelative, sha256, writeZip, extractZip } from './pack-zip.mjs';

const ARCHITECTURES = { x86_64: { docker: 'amd64', node: 'x64' }, arm64: { docker: 'arm64', node: 'arm64' } };
const FORBIDDEN = /^(?:\.git|\.aws|\.ssh|\.npmrc|\.env(?:\..*)?|env|secrets?|credentials?|node_modules|\.artifacts)$/i;
const SECRET_FILE = /(?:\.(?:pem|key|p12|pfx)$|(?:^|[._-])(?:secrets?|credentials?)(?:[._-]|$))/i;
export function parseArgs(args) {
    const result = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--help' || args[i] === '-h') {
            result.help = true;
            continue;
        }
        const match = /^--(runtime|architecture|output|config)(?:=(.*))?$/.exec(args[i]);
        if (!match) throw new Error(`Unknown argument: ${args[i]} (see --help)`);
        const value = match[2] ?? args[++i];
        if (!value || value.startsWith('--')) throw new Error(`--${match[1]} needs a value`);
        if (result[match[1]] !== undefined) throw new Error(`Duplicate option: --${match[1]}`);
        result[match[1]] = value;
    }
    return result;
}
function relativeInput(value) {
    safeRelative(value);
    if (value.split('/').some(p => FORBIDDEN.test(p)) || SECRET_FILE.test(path.posix.basename(value)))
        throw new Error(`Forbidden source path: ${value}`);
    return value;
}
export function validateConfig(value, options = {}) {
    const allowed = [
        'schemaVersion',
        'runtime',
        'architecture',
        'image',
        'sourcePaths',
        'runtimePaths',
        'handler',
        'buildScript',
        'outputRoot',
        'maxZipBytes',
        'maxUncompressedBytes',
    ];
    for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown config key: ${key}`);
    if (value.schemaVersion !== 1) throw new Error('pack config schemaVersion must be 1');
    const config = {
        ...value,
        runtime: options.runtime ?? value.runtime,
        architecture: options.architecture ?? value.architecture,
    };
    if (config.runtime !== 'nodejs24.x') throw new Error('Supported runtime: nodejs24.x (Amazon Linux 2023)');
    if (!ARCHITECTURES[config.architecture]) throw new Error('Supported architecture: x86_64 or arm64');
    if (
        typeof config.image !== 'string' ||
        !/^public\.ecr\.aws\/lambda\/nodejs:(?:24|24[.\w-]*)(?:@sha256:[a-f0-9]{64})?$/.test(config.image)
    )
        throw new Error('image must be the public Lambda Node 24 image (optionally digest pinned)');
    for (const key of ['sourcePaths', 'runtimePaths']) {
        if (!Array.isArray(config[key]) || !config[key].length || new Set(config[key]).size !== config[key].length)
            throw new Error(`${key} must be a nonempty unique array`);
        config[key].forEach(relativeInput);
        for (const item of config[key])
            if (config[key].some(other => other !== item && item.startsWith(`${other}/`)))
                throw new Error(`Overlapping ${key}: ${item}`);
    }
    for (const required of ['package.json', 'package-lock.json'])
        if (!config.sourcePaths.includes(required)) throw new Error(`sourcePaths must include ${required}`);
    if (
        !config.handler ||
        typeof config.handler.file !== 'string' ||
        typeof config.handler.export !== 'string' ||
        !/^[\w$]+$/.test(config.handler.export)
    )
        throw new Error('handler requires file and export');
    relativeInput(config.handler.file);
    if (config.handler.file.includes('/') || !/\.(?:c?js|mjs)$/.test(config.handler.file))
        throw new Error('handler file must be at the ZIP root');
    if (!config.runtimePaths.includes(config.handler.file)) throw new Error('runtimePaths must include handler.file');
    if (typeof config.buildScript !== 'string' || !/^[\w:-]+$/.test(config.buildScript))
        throw new Error('Invalid buildScript');
    safeRelative(config.outputRoot);
    config.maxZipBytes ??= 50 * 1024 ** 2;
    config.maxUncompressedBytes ??= 250 * 1024 ** 2;
    for (const key of ['maxZipBytes', 'maxUncompressedBytes'])
        if (!Number.isSafeInteger(config[key]) || config[key] <= 0 || config[key] > 250 * 1024 ** 2)
            throw new Error(`${key} must be between 1 and 262144000`);
    return config;
}
async function json(file) {
    return JSON.parse(await readFile(file, 'utf8'));
}
function within(root, target) {
    return target === root || target.startsWith(`${root}${path.sep}`);
}
async function exists(file) {
    try {
        await lstat(file);
        return true;
    } catch (e) {
        if (e.code === 'ENOENT') return false;
        throw e;
    }
}
export async function copySource(root, destination, paths) {
    for (const name of paths) {
        relativeInput(name);
        const source = path.join(root, name);
        const stat = await lstat(source);
        if (!within(await realpath(root), await realpath(source))) throw new Error(`Source path escapes root: ${name}`);
        if (stat.isSymbolicLink()) throw new Error(`Source symlink is not allowed: ${name}`);
        if (stat.isDirectory()) {
            await mkdir(path.join(destination, name), { recursive: true, mode: 0o755 });
            const children = (await readdir(source)).sort();
            for (const child of children) {
                const nested = `${name}/${child}`;
                // Exclusions apply at every depth, including otherwise allowed data/src trees.
                if (FORBIDDEN.test(child) || SECRET_FILE.test(child) || child.startsWith('.')) continue;
                await copySource(root, destination, [nested]);
            }
        } else if (stat.isFile()) {
            await mkdir(path.dirname(path.join(destination, name)), { recursive: true, mode: 0o755 });
            await cp(source, path.join(destination, name), { errorOnExist: true, force: false });
        } else throw new Error(`Unsupported source file: ${name}`);
    }
}
export function validateLock(pkg, lock) {
    if (![2, 3].includes(lock.lockfileVersion) || !lock.packages?.[''])
        throw new Error('package-lock.json v2 or v3 is required');
    const root = lock.packages[''];
    for (const key of [
        'name',
        'version',
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
    ]) {
        const stable = obj =>
            JSON.stringify(
                obj && typeof obj === 'object'
                    ? Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
                    : obj,
            );
        if (stable(pkg[key]) !== stable(root[key]))
            throw new Error(`package-lock.json root mismatch: ${key}; refresh the lockfile intentionally`);
    }
    // Local/workspace packages could escape the snapshot or reuse a host checkout.
    for (const [name, entry] of Object.entries(lock.packages)) {
        if (entry.link || (entry.resolved && /^(?:file:|link:|\.\.?\/|\/)/.test(entry.resolved)))
            throw new Error(`Local dependency is unsupported: ${name}`);
    }
}
export function deploymentPackage(pkg) {
    const keep = [
        'name',
        'version',
        'description',
        'private',
        'type',
        'main',
        'exports',
        'imports',
        'dependencies',
        'optionalDependencies',
        'peerDependencies',
        'peerDependenciesMeta',
        'engines',
        'license',
    ];
    return Object.fromEntries(keep.filter(key => pkg[key] !== undefined).map(key => [key, pkg[key]]));
}
const projectExcluded = name =>
    name
        .split('/')
        .some(
            p => ['src', 'test', 'tests', '__tests__', 'test-helpers', 'bin', 'env'].includes(p) || p.startsWith('.'),
        ) || /(?:\.d\.(?:ts|mts|cts)(?:\.map)?|\.tsbuildinfo|\.(?:spec|test)\.[^/]+)$/.test(name);
export async function collectFiles(root, { project = false, prefix = '' } = {}) {
    const files = [];
    async function visit(name) {
        safeRelative(name);
        if (project && projectExcluded(name)) return;
        const source = path.join(root, name);
        const stat = await lstat(source);
        if (stat.isSymbolicLink()) {
            const target = await realpath(source);
            if (!within(await realpath(root), target)) throw new Error(`Symlink escapes package: ${name}`);
            files.push({ path: `${prefix}${name}`, source, link: await readlink(source) });
        } else if (stat.isDirectory()) {
            for (const child of (await readdir(source)).sort()) await visit(`${name}/${child}`);
        } else if (stat.isFile())
            files.push({ path: `${prefix}${name}`, source, executable: Boolean(stat.mode & 0o111) });
        else throw new Error(`Unsupported package file: ${name}`);
    }
    for (const name of (await readdir(root)).sort()) await visit(name);
    return files;
}

export function runCommand(command, args, { cwd, capture = false, timeout = 20 * 60 * 1000, killGraceMs = 1000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '',
            stderr = '',
            timedOut = false,
            settled = false,
            killTimer;
        const failure = code =>
            new Error(
                `${command} ${args[0] ?? ''} failed${timedOut ? ' (timeout)' : ` (exit ${code})`}${
                    capture && stderr ? `: ${stderr.trim()}` : ''
                }`,
            );
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clearTimeout(killTimer);
            if (error) reject(error);
            else resolve(value);
        };
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            killTimer = setTimeout(() => {
                child.kill('SIGKILL');
                // Descendants can keep inherited pipes open after the child dies. Do not let
                // their streams prevent timeout rejection and named-container cleanup.
                child.stdout.destroy();
                child.stderr.destroy();
                finish(failure(null));
            }, killGraceMs);
        }, timeout);
        child.stdout.on('data', bytes => {
            stdout = (stdout + bytes).slice(-4 * 1024 ** 2);
            if (!capture) process.stdout.write(bytes);
        });
        child.stderr.on('data', bytes => {
            stderr = (stderr + bytes).slice(-4 * 1024 ** 2);
            if (!capture) process.stderr.write(bytes);
        });
        child.on('error', error => finish(error));
        child.on('close', code => finish(code !== 0 || timedOut ? failure(code) : null, stdout));
    });
}

function runtimeProbe(architecture) {
    return `const fs=require('node:fs');const os=fs.readFileSync('/etc/os-release','utf8');if(process.platform!=='linux'||process.arch!==${JSON.stringify(
        ARCHITECTURES[architecture].node,
    )}||process.versions.node.split('.')[0]!=='24'||!/^ID="?amzn"?$/m.test(os)||!/^VERSION_ID="?2023"?$/m.test(os))throw Error('Lambda runtime/OS/architecture mismatch');console.log('PACK_RUNTIME='+JSON.stringify({node:process.version,architecture:process.arch,osRelease:os}));`;
}
function dockerArgs(
    image,
    platform,
    mount,
    script,
    { network = true, readonly = false, lambdaEnvironment = false, name } = {},
) {
    const args = [
        'run',
        '--rm',
        '--name',
        name,
        '--platform',
        platform,
        '--entrypoint',
        '/bin/sh',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
    ];
    if (process.getuid) args.push('--user', `${process.getuid()}:${process.getgid()}`);
    if (!network) args.push('--network=none');
    if (readonly) args.push('--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m');
    if (lambdaEnvironment)
        args.push(
            '-e',
            'AWS_LAMBDA_FUNCTION_NAME=pack-smoke',
            '-e',
            'AWS_EXECUTION_ENV=AWS_Lambda_nodejs24.x',
            '-e',
            'LAMBDA_TASK_ROOT=/var/task',
        );
    args.push(
        '--mount',
        `type=bind,src=${mount},dst=/var/task${readonly ? ',readonly' : ''}`,
        '--workdir',
        '/var/task',
        '-e',
        'HOME=/tmp',
        '-e',
        'NPM_CONFIG_CACHE=/tmp/npm-cache',
        '-e',
        'NPM_CONFIG_USERCONFIG=/tmp/pack-user.npmrc',
        '-e',
        'NPM_CONFIG_GLOBALCONFIG=/tmp/pack-global.npmrc',
        '-e',
        'AWS_EC2_METADATA_DISABLED=true',
        '-e',
        'AWS_REGION=us-east-1',
        '-e',
        'AWS_DEFAULT_REGION=us-east-1',
        image,
        '-c',
        script,
    );
    return args;
}
const shellQuote = text => `'${String(text).replaceAll("'", "'\\''")}'`;

export async function pack({ cwd = process.cwd(), options = {}, run = runCommand, log = console.log } = {}) {
    const started = performance.now();
    const timings = {};
    const timed = async (stage, action) => {
        log(`[pack] ${stage}`);
        const start = performance.now();
        const result = await action();
        timings[stage] = Math.round(performance.now() - start);
        return result;
    };
    const root = await realpath(cwd);
    const configPath = path.resolve(root, options.config ?? 'pack.config.json');
    const config = validateConfig(await json(configPath), options);
    const platform = `linux/${ARCHITECTURES[config.architecture].docker}`;
    const id = randomUUID();
    const output = path.resolve(
        root,
        options.output ??
            path.join(
                config.outputRoot,
                `${config.runtime}-${config.architecture}-${new Date().toISOString().replaceAll(':', '-')}-${id.slice(
                    0,
                    8,
                )}`,
            ),
    );
    if (await exists(output)) throw new Error(`Output already exists; choose a new directory: ${output}`);
    if (config.sourcePaths.some(name => within(path.join(root, name), output)))
        throw new Error('Output must be outside sourcePaths');
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'lambda-pack-'));
    let publication;
    const build = path.join(temporary, 'build');
    const production = path.join(temporary, 'production');
    const runtime = path.join(temporary, 'runtime');
    const extracted = path.join(temporary, 'extracted');
    const dockerRun = async (phase, mount, script, settings) => {
        const name = `lambda-pack-${id}-${phase}`;
        try {
            return await run('docker', dockerArgs(image.Id, platform, mount, script, { name, ...settings }), {
                capture: settings?.capture,
                ...(settings?.timeout ? { timeout: settings.timeout } : {}),
            });
        } catch (error) {
            await run('docker', ['rm', '-f', name], { capture: true, timeout: 10000 }).catch(() => {});
            throw error;
        }
    };
    let image;
    try {
        await timed('snapshot', async () => {
            await mkdir(build);
            await copySource(root, build, config.sourcePaths);
        });
        const pkg = await json(path.join(build, 'package.json'));
        const lock = await json(path.join(build, 'package-lock.json'));
        validateLock(pkg, lock);
        if (!pkg.scripts?.[config.buildScript]) throw new Error(`Missing npm build script: ${config.buildScript}`);
        const lockSha256 = sha256(await readFile(path.join(build, 'package-lock.json')));
        const sourceFiles = await collectFiles(build);
        const sourceInventory = await Promise.all(
            sourceFiles.map(async file => ({ path: file.path, sha256: sha256(await readFile(file.source)) })),
        );
        const sourceSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: root, capture: true })).trim();
        const sourceDirty = Boolean(
            (
                await run('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, capture: true })
            ).trim(),
        );
        await timed('image', async () => {
            try {
                image = JSON.parse(await run('docker', ['image', 'inspect', config.image], { capture: true }))[0];
            } catch {
                /* Pull only when missing. */
            }
            if (!image || image.Os !== 'linux' || image.Architecture !== ARCHITECTURES[config.architecture].docker) {
                await run('docker', ['pull', '--platform', platform, config.image]);
                image = JSON.parse(await run('docker', ['image', 'inspect', config.image], { capture: true }))[0];
            }
            if (
                image.Os !== 'linux' ||
                image.Architecture !== ARCHITECTURES[config.architecture].docker ||
                !/^sha256:[a-f0-9]{64}$/.test(image.Id)
            )
                throw new Error('Docker image OS/architecture does not match target');
        });
        const probe = runtimeProbe(config.architecture);
        const probeOutput = await timed('runtimeCheck', () =>
            dockerRun('probe', build, `node -e ${shellQuote(probe)}`, {
                network: false,
                readonly: true,
                capture: true,
            }),
        );
        const environment = JSON.parse(
            probeOutput
                .split('\n')
                .find(line => line.startsWith('PACK_RUNTIME='))
                ?.slice('PACK_RUNTIME='.length) ?? 'null',
        );
        if (!environment) throw new Error('Runtime probe did not return evidence');
        await timed('build', () =>
            dockerRun(
                'build',
                build,
                `npm ci --include=dev --no-audit --no-fund && npm run ${shellQuote(config.buildScript)}`,
            ),
        );
        await mkdir(production);
        const installPackage = { ...pkg };
        delete installPackage.scripts; // Root lifecycle hooks cannot pull build tooling into staging.
        delete installPackage.devDependencies;
        // Keep the entire resolved graph, removing only root development declarations. This also
        // avoids promoting a dev-only optional peer (for example TypeScript) into production.
        const installLock = structuredClone(lock);
        delete installLock.packages[''].devDependencies;
        delete installLock.packages[''].scripts;
        await writeFile(path.join(production, 'package.json'), `${JSON.stringify(installPackage, null, 2)}\n`);
        await writeFile(path.join(production, 'package-lock.json'), `${JSON.stringify(installLock, null, 2)}\n`);
        await timed('productionInstall', () =>
            dockerRun('production', production, 'npm ci --omit=dev --no-audit --no-fund'),
        );
        await mkdir(runtime);
        await timed('stage', async () => {
            await copySource(build, runtime, config.runtimePaths);
            await writeFile(path.join(runtime, 'package.json'), `${JSON.stringify(deploymentPackage(pkg), null, 2)}\n`);
        });
        const entries = await collectFiles(runtime, { project: true });
        const dependencies = await collectFiles(path.join(production, 'node_modules'), { prefix: 'node_modules/' });
        // npm's private install ledger is unnecessary at runtime; dependency package contents stay intact.
        entries.push(...dependencies.filter(file => file.path !== 'node_modules/.package-lock.json'));
        if (!entries.some(file => file.path === config.handler.file))
            throw new Error('Root handler missing from runtime files');
        await mkdir(path.dirname(output), { recursive: true });
        publication = await mkdtemp(path.join(path.dirname(output), '.pack-publish-'));
        const zipPath = path.join(publication, 'lambda.zip');
        const archive = await timed('zip', () => writeZip(zipPath, entries, config));
        await timed('extract', () => extractZip(zipPath, extracted, archive.files));
        const smoke = `${probe}\n(async()=>{const m=await import(require('node:url').pathToFileURL(${JSON.stringify(
            `/var/task/${config.handler.file}`,
        )}));if(typeof(m[${JSON.stringify(config.handler.export)}]??m.default?.[${JSON.stringify(
            config.handler.export,
        )}])!=='function')throw Error('Handler export is not a function');await new Promise(resolve=>setImmediate(resolve));console.log('PACK_HANDLER_OK')})().catch(e=>{console.error(e);process.exit(1)});`;
        const smokeOutput = await timed('handlerSmoke', () =>
            dockerRun('smoke', extracted, `node -e ${shellQuote(smoke)}`, {
                network: false,
                readonly: true,
                capture: true,
                timeout: 60000,
                lambdaEnvironment: true,
            }),
        );
        if (!smokeOutput.split('\n').includes('PACK_HANDLER_OK'))
            throw new Error('Handler smoke did not return success evidence');
        await timed('cleanup', () => rm(temporary, { recursive: true, force: true }));
        const manifest = {
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
            packer: {
                node: process.version,
                zlib: process.versions.zlib,
                platform: process.platform,
                architecture: process.arch,
            },
            package: { name: pkg.name, version: pkg.version },
            source: {
                gitSha: sourceSha,
                dirty: sourceDirty,
                snapshotSha256: sha256(JSON.stringify(sourceInventory)),
                files: sourceInventory,
            },
            lockfileSha256: lockSha256,
            productionInstall: {
                command: 'npm ci --omit=dev --no-audit --no-fund',
                transformation:
                    'remove root scripts and devDependencies from package.json and lock.packages[""]; preserve resolved graph',
                installScriptPolicy: 'npm image defaults and project allowScripts; no universal script approval',
                allowScripts: pkg.allowScripts ?? null,
                lockfileSha256: sha256(JSON.stringify(installLock, null, 2) + '\n'),
            },
            configSha256: sha256(JSON.stringify(config)),
            runtime: config.runtime,
            architecture: config.architecture,
            platform,
            image: { reference: config.image, id: image.Id, digests: image.RepoDigests ?? [] },
            environment,
            archive: {
                file: 'lambda.zip',
                sha256: sha256(await readFile(zipPath)),
                bytes: archive.bytes,
                uncompressedBytes: archive.uncompressedBytes,
                fileCount: archive.files.length,
            },
            validation: {
                lockfile: 'passed',
                runtime: 'passed',
                zipRoundTrip: 'passed',
                handlerExport: 'passed',
                smokeNetwork: 'none',
                handler: config.handler,
                awsDeployment: 'not-performed',
            },
            nativeModules: archive.files.filter(file => file.path.endsWith('.node')).map(file => file.path),
            timingsMs: { ...timings, total: Math.round(performance.now() - started) },
            files: archive.files,
        };
        await writeFile(path.join(publication, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
            mode: 0o644,
        });
        await chmod(publication, 0o755);
        // Never replace an existing result; a directory rename publishes ZIP + manifest together.
        if (await exists(output)) throw new Error(`Output appeared during packaging: ${output}`);
        await rename(publication, output);
        publication = undefined;
        log(`[pack] complete: ${output}`);
        return { output, manifest };
    } finally {
        await rm(temporary, { recursive: true, force: true });
        if (publication) await rm(publication, { recursive: true, force: true });
    }
}
