import { readFile, writeFile, mkdir, lstat, readdir, realpath, rename, open, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { validateConfig as validateDeployConfig } from './deploy-plan.mjs';
import { runPrivateChild } from './migrate-process.mjs';
import { validateDiagnostic } from './migrate-diagnostic.mjs';
import { ORG_DEFAULTS } from './org-defaults.mjs';

//* v5 B19: the migration pins come from `org-defaults.mjs` (values unchanged).
const MIGRATION = ORG_DEFAULTS.migration;

//* v5 B24: the reviewed target registry (frozen); one entry per supported stack.
export const TARGETS = MIGRATION.targets;
export const PHASES = ['plan', 'retain', 'remove', 'tag', 'apply', 'verify'];
// the config keys that must equal one registry entry (B19 order).
const IDENTITY = ['project', 'stage', 'stack'];
const hash = x => createHash('sha256').update(x).digest('hex');
const canonical = x => JSON.stringify(x);
export class MigrationError extends Error {
    constructor(code, message, { unknown = false } = {}) {
        super(message);
        this.code = code;
        this.unknown = unknown;
        this.name = 'MigrationError';
    }
}
const fail = (code, message, unknown = false) => {
    throw new MigrationError(code, message, { unknown });
};
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
//* v5 B24: the registry entry whose project/stage/stack all equal the config's, else undefined.
export const findTarget = c => (object(c) ? TARGETS.find(t => IDENTITY.every(k => c[k] === t[k])) : undefined);
//* v5 B24: the matched registry entry; a config outside the registry is TARGET_MISMATCH.
export function migrationTarget(c) {
    const target = findTarget(c);
    if (!target)
        fail(
            'TARGET_MISMATCH',
            `Only reviewed migration targets are supported: ${TARGETS.map(t => `${t.project} ${t.stage}`).join(', ')}.`,
        );
    return target;
}
// the public identity of an entry, in the B19 key order (`project`, `stage`, `stack`).
const identity = t => Object.fromEntries(IDENTITY.map(k => [k, t[k]]));
const text = (v, re, field) => {
    if (typeof v !== 'string' || !re.test(v)) fail('INVALID_INPUT', `Invalid ${field}.`);
    return v;
};
export async function json(file) {
    try {
        return JSON.parse(await readFile(file, 'utf8'));
    } catch {
        fail('INVALID_INPUT', 'Could not read a required JSON file.');
    }
}
export function validateMigrationConfig(raw, configFile) {
    const allowed = [
        'schemaVersion',
        'project',
        'stage',
        'stack',
        'migrationRepo',
        'migrationRevision',
        'region',
        'account',
        'profile',
        'endpoint',
        'artifactBucket',
        'kmsDecryptKeyArn',
        'kmsEncryptKeyArn',
        'runtime',
        'timeoutMs',
    ];
    if (!object(raw) || Object.keys(raw).some(k => !allowed.includes(k)) || raw.schemaVersion !== 1)
        fail('INVALID_INPUT', 'Invalid migration config.');
    const target = migrationTarget(raw);
    if (raw.migrationRevision !== target.revision) fail('REVISION_MISMATCH', 'Unsupported migration revision.');
    text(raw.migrationRepo, /^[^\0\r\n]+$/, 'migrationRepo');
    text(raw.profile, /^[A-Za-z0-9_.@-]{1,128}$/, 'profile');
    // Reuse the deployed-code target validator; this does not read credentials or contact AWS.
    const deployTarget = validateDeployConfig({
        schemaVersion: 1,
        mode: 'code',
        project: raw.project,
        stage: raw.stage,
        region: raw.region,
        account: raw.account,
        profile: raw.profile,
        endpoint: raw.endpoint,
        artifactBucket: raw.artifactBucket,
        keyPrefix: 'migration',
    });
    const c = {
        ...raw,
        endpoint: deployTarget.endpoint,
        migrationRepo: path.resolve(path.dirname(configFile), raw.migrationRepo),
        timeoutMs: raw.timeoutMs ?? 1800000,
    };
    if (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 1000 || c.timeoutMs > 7200000)
        fail('INVALID_INPUT', 'Invalid timeoutMs.');
    if (c.runtime !== undefined && c.runtime !== 'nodejs24.x')
        fail('INVALID_INPUT', 'Only an explicit nodejs24.x runtime override is supported.');
    for (const key of ['kmsDecryptKeyArn', 'kmsEncryptKeyArn'])
        if (c[key] !== undefined)
            text(c[key], new RegExp(`^arn:aws:kms:${c.region}:${c.account}:key/[A-Za-z0-9-]+$`), key);
    return c;
}
export function rejectPlaceholders(c) {
    if (
        ['123456789012', '000000000000', '111111111111', '999999999999'].includes(c.account) ||
        /example|replace|placeholder|changeme/i.test(
            [c.endpoint, c.profile, c.artifactBucket, c.kmsDecryptKeyArn ?? '', c.kmsEncryptKeyArn ?? ''].join(' '),
        )
    )
        fail('PLACEHOLDER_INPUT', 'Replace example account and installation settings before execution.');
}
export function targetEnvironment(c, parent = process.env) {
    const env = Object.fromEntries(
        Object.entries(parent).filter(
            ([k]) =>
                !k.startsWith('AGT_') &&
                !k.startsWith('AWS_ENDPOINT_URL') &&
                !k.startsWith('GIT_') &&
                ![
                    'AWS_ACCESS_KEY_ID',
                    'AWS_SECRET_ACCESS_KEY',
                    'AWS_SESSION_TOKEN',
                    'AWS_SECURITY_TOKEN',
                    'NODE_OPTIONS',
                    'NODE_PATH',
                ].includes(k),
        ),
    );
    return {
        ...env,
        AGT_BASE: c.endpoint,
        AGT_PROFILE: c.profile,
        AGT_REGION: c.region,
        AGT_ACCOUNT: c.account,
        AWS_PROFILE: c.profile,
        AWS_DEFAULT_PROFILE: c.profile,
        AWS_REGION: c.region,
        AWS_DEFAULT_REGION: c.region,
        AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
        AWS_PAGER: '',
        AWS_CLI_AUTO_PROMPT: 'off',
    };
}
export async function validateRepository(
    c,
    { revision = migrationTarget(c).revision, origin = MIGRATION.origin } = {},
) {
    const root = await realpath(c.migrationRepo).catch(() =>
        fail('REPOSITORY_INVALID', 'Migration checkout is unavailable.'),
    );
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
    const git = async (args, { raw = false } = {}) => {
        try {
            const { stdout } = await promisify(execFile)(
                'git',
                ['--no-replace-objects', '-c', 'core.fsmonitor=false', '-C', root, ...args],
                {
                    env,
                    encoding: raw ? null : 'utf8',
                    timeout: 5000,
                    maxBuffer: 1024 * 1024,
                },
            );
            return raw ? stdout : stdout.trim();
        } catch {
            fail('REPOSITORY_INVALID', 'Could not validate the migration checkout.');
        }
    };
    if ((await git(['rev-parse', '--show-toplevel'])) !== root || (await git(['rev-parse', 'HEAD'])) !== revision)
        fail('REVISION_MISMATCH', 'Migration checkout HEAD differs from the supported revision.');
    const remote = await git(['remote', 'get-url', 'origin']);
    const normalized = remote
        .replace(/^git@github\.com:/, '')
        .replace(/^https:\/\/github\.com\//, '')
        .replace(/\.git$/, '');
    if (normalized !== origin) fail('REPOSITORY_INVALID', 'Migration origin differs from the canonical repository.');
    if (await git(['status', '--porcelain', '--untracked-files=no']))
        fail('REPOSITORY_DIRTY', 'Tracked migration checkout changes are not executable.');
    for (const rel of [MIGRATION.entry, MIGRATION.imports]) {
        await git(['ls-files', '--error-unmatch', rel]);
        const expected = path.join(root, rel);
        const resolved = await realpath(expected).catch(() =>
            fail('REPOSITORY_INVALID', 'Migration entry/import is unavailable.'),
        );
        const st = await lstat(expected);
        if (resolved !== expected || !st.isFile() || st.isSymbolicLink())
            fail('REPOSITORY_INVALID', 'Migration entry/import and its ancestors must not redirect through symlinks.');
        // Git status can hide changes marked assume-unchanged or skip-worktree.
        const pinned = await git(['show', `${revision}:${rel}`], { raw: true });
        if (hash(pinned) !== hash(await readFile(expected)))
            fail('REPOSITORY_DIRTY', 'Migration entry/import bytes differ from the pinned Git blob.');
    }
    return root;
}
export function commandFor(c, phase, execute = false) {
    const args = [phase, c.stack];
    if (phase === 'plan') {
        args.push('--artifact-bucket', c.artifactBucket);
        if (c.runtime) args.push('--runtime', c.runtime);
        if (c.kmsDecryptKeyArn) args.push('--kms-decrypt-key', c.kmsDecryptKeyArn);
        if (c.kmsEncryptKeyArn) args.push('--kms-encrypt-key', c.kmsEncryptKeyArn);
    }
    if (execute && ['retain', 'remove', 'tag'].includes(phase)) args.push('--go');
    return { command: process.execPath, args: [path.join(c.migrationRepo, MIGRATION.entry), ...args] };
}
export function migrationPlan(c, phase) {
    const target = migrationTarget(c);
    return {
        schemaVersion: 1,
        execution: 'offline-plan',
        phase,
        target: {
            ...identity(target),
            account: c.account,
            region: c.region,
            profile: c.profile,
            endpoint: c.endpoint,
            artifactBucket: c.artifactBucket,
        },
        migrationRepo: c.migrationRepo,
        migrationRevision: target.revision,
        command: commandFor(c, phase, true),
        runtimeOverride: c.runtime ?? null,
        sequence: PHASES,
        effect: {
            plan: 'Reads live configuration and downloads deployed ZIPs; stores sensitive environment backup.',
            retain: 'Updates CloudFormation retain policies.',
            remove: 'Empties the Serverless deployment bucket and deletes the stack; retained data/API survive.',
            tag: 'Writes management tags on retained resources.',
            apply: 'Writes via deploy tools WITHOUT upstream --go; redeploys the OLD backed-up code.',
            verify: 'Reads live resources and HTTP probes; stores a comparison snapshot.',
        }[phase],
        requiredFlags: [
            '--execute',
            ...(phase === 'plan' ? ['--allow-sensitive-backup'] : []),
            ...(phase === 'remove' ? [`--confirm-stack ${target.stack}`] : []),
        ],
        limitations: [
            'No migration or AWS command has run.',
            'Upstream apply retries failures internally and some polls have no bound; wrapper deadline does not change that policy.',
            'Verify compares environment keys and selected resource properties, not complete operational equivalence.',
        ],
    };
}
//* v5 B27: exported (with `privateEntry`, `noSymlinkChain`, `validateOwned`) for the read-only follow-up commands.
export const fingerprint = c => hash(canonical(c));
export async function privateEntry(file, type) {
    const s = await lstat(file).catch(() => fail('PRIVATE_STATE_INVALID', 'Required private state is missing.'));
    if (
        s.isSymbolicLink() ||
        (type === 'dir' && !s.isDirectory()) ||
        (type === 'file' && !s.isFile()) ||
        s.uid !== process.getuid() ||
        (type === 'file' && s.nlink !== 1) ||
        (s.mode & 0o777) !== (type === 'dir' ? 0o700 : 0o600)
    )
        fail('PRIVATE_STATE_INVALID', 'Private state requires owned regular directories/files with modes 0700/0600.');
    return s;
}
export async function noSymlinkChain(root, relative) {
    let p = root;
    for (const part of relative.split('/')) {
        p = path.join(p, part);
        const s = await lstat(p).catch(() => null);
        if (s && (s.isSymbolicLink() || !s.isDirectory()))
            fail('PRIVATE_STATE_INVALID', 'Run-directory parent must not be a symlink.');
    }
}
async function atomic(file, value) {
    const tmp = `${file}.tmp-${randomUUID()}`;
    await writeFile(tmp, canonical(value) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(tmp, file);
}
async function saveReceipt(file, payload) {
    await atomic(file, { payload, sha256: hash(canonical(payload)) });
}
export async function readReceipt(file) {
    const absolute = path.resolve(file);
    await noSymlinkChain(path.parse(absolute).root, path.dirname(absolute).slice(path.parse(absolute).root.length));
    await privateEntry(path.dirname(file), 'dir');
    await privateEntry(file, 'file');
    const envelope = await json(file);
    if (
        !object(envelope.payload) ||
        envelope.sha256 !== hash(canonical(envelope.payload)) ||
        envelope.payload.schemaVersion !== 1
    )
        fail('RECEIPT_INVALID', 'Migration receipt integrity check failed.');
    return envelope.payload;
}
async function privateTree(root) {
    await privateEntry(root, 'dir');
    for (const item of await readdir(root, { withFileTypes: true })) {
        const p = path.join(root, item.name);
        if (item.isSymbolicLink()) fail('PRIVATE_STATE_INVALID', 'Symlink in private migration state.');
        if (item.isDirectory()) await privateTree(p);
        else await privateEntry(p, 'file');
    }
}
export async function snapshotIdentity(run, c, { after = false } = {}) {
    const target = migrationTarget(c);
    await privateTree(run);
    const plan = await json(path.join(run, 'plan.json')),
        env = await json(path.join(run, 'env.json')),
        before = await json(path.join(run, 'before.json'));
    if (
        plan.project !== c.project ||
        plan.stage !== c.stage ||
        plan.stack !== c.stack ||
        plan.artifactBucket !== c.artifactBucket ||
        !Array.isArray(plan.warnings) ||
        plan.warnings.length
    )
        fail('SNAPSHOT_INVALID', 'Snapshot target mismatch or unresolved migration warnings.');
    if (
        (plan.kms?.decrypt ?? undefined) !== c.kmsDecryptKeyArn ||
        (plan.kms?.encrypt ?? undefined) !== c.kmsEncryptKeyArn
    )
        fail('SNAPSHOT_INVALID', 'Snapshot KMS settings differ from config.');
    //* v5 B24: the two dev functions of the matched stack (`<stack>-lambda`, `<stack>-backend`; B19 had `<project>-dev-*`).
    const expected = [`${target.stack}-lambda`, `${target.stack}-backend`].sort();
    if (
        !Array.isArray(plan.functions) ||
        plan.functions.length !== 2 ||
        canonical(plan.functions.map(f => f.name).sort()) !== canonical(expected) ||
        !object(env) ||
        canonical(Object.keys(env).sort()) !== canonical(expected) ||
        !object(before.functions)
    )
        fail('SNAPSHOT_INVALID', `Snapshot must contain exactly the two dev functions of ${target.stack}.`);
    if (
        !object(plan.codeFiles) ||
        !object(plan.api) ||
        typeof plan.api.id !== 'string' ||
        before.api?.id !== plan.api.id
    )
        fail('SNAPSHOT_INVALID', 'Snapshot API/code identity is missing.');
    const files = ['plan.json', 'env.json', 'before.json'];
    for (const f of plan.functions) {
        const old = before.functions[f.name];
        if (
            !object(env[f.name]) ||
            Object.values(env[f.name]).some(v => typeof v !== 'string') ||
            !object(old) ||
            old.codeSha !== f.codeSha ||
            old.handler !== f.handler ||
            old.memory !== f.memory ||
            old.timeout !== f.timeout ||
            canonical([...old.envKeys].sort()) !== canonical(Object.keys(env[f.name]).sort())
        )
            fail('SNAPSHOT_INVALID', 'Function/environment backup does not match its before snapshot.');
        if (
            !['nodejs24.x', 'nodejs22.x', 'nodejs20.x'].includes(f.runtime) ||
            (c.runtime && f.runtime !== c.runtime) ||
            !Number.isInteger(f.memory) ||
            f.memory < 128 ||
            f.memory > 1024 ||
            !Number.isInteger(f.timeout) ||
            f.timeout < 1 ||
            f.timeout > 300
        )
            fail('SNAPSHOT_INVALID', 'Function settings exceed the supported migration tool contract.');
        const rel = plan.codeFiles[f.codeSha];
        if (
            typeof f.codeSha !== 'string' ||
            !/^[A-Za-z0-9+/]{43}=$/.test(f.codeSha) ||
            typeof rel !== 'string' ||
            !/^code\/[a-f0-9]{64}\.zip$/.test(rel)
        )
            fail('SNAPSHOT_INVALID', 'Invalid old-code backup identity.');
        await privateEntry(path.join(run, rel), 'file');
        const bytes = await readFile(path.join(run, rel));
        if (
            bytes.length < 1 ||
            bytes.length > 50000000 ||
            hash(bytes) !== rel.slice(5, -4) ||
            Buffer.from(hash(bytes), 'hex').toString('base64') !== f.codeSha
        )
            fail('SNAPSHOT_INVALID', 'Old-code ZIP hash mismatch.');
        files.push(rel);
    }
    if (after) {
        const value = await json(path.join(run, 'after.json'));
        if (
            !object(value.functions) ||
            canonical(Object.keys(value.functions).sort()) !== canonical(expected) ||
            value.api?.id !== plan.api.id
        )
            fail('SNAPSHOT_INVALID', 'Verification snapshot identity is missing.');
        files.push('after.json');
    }
    const hashes = {};
    for (const rel of [...new Set(files)].sort()) hashes[rel] = hash(await readFile(path.join(run, rel)));
    return hashes;
}
export async function validateOwned(run, c) {
    const target = migrationTarget(c);
    await privateTree(run);
    const owner = await json(path.join(run, target.ownerFile));
    if (
        owner.schemaVersion !== 1 ||
        owner.tool !== target.ownerTool ||
        owner.fingerprint !== fingerprint(c) ||
        !owner.id
    )
        fail('STATE_MISMATCH', 'Run directory is not owned by this target/config.');
    const receipt = await readReceipt(path.join(run, target.receiptFile));
    if (
        receipt.ownerId !== owner.id ||
        receipt.fingerprint !== owner.fingerprint ||
        canonical(receipt.config) !== canonical(c)
    )
        fail('STATE_MISMATCH', 'Migration receipt belongs to a different config.');
    return receipt;
}
export async function verifyMigrationReceipt(file, deployConfig) {
    const receipt = await readReceipt(file),
        c = receipt.config;
    validateMigrationConfig(c, file);
    const target = migrationTarget(c);
    if (
        !object(c) ||
        receipt.fingerprint !== fingerprint(c) ||
        receipt.status !== 'completed' ||
        canonical(receipt.completed) !== canonical(PHASES)
    )
        fail('RECEIPT_INVALID', 'Migration must have a complete successful verify receipt.');
    for (const k of ['project', 'stage', 'region', 'account', 'profile', 'endpoint', 'artifactBucket'])
        if (c[k] !== deployConfig[k]) fail('TARGET_MISMATCH', 'Migration receipt and dev deployment target differ.');
    const run = path.dirname(path.resolve(file));
    const root = await realpath(c.migrationRepo).catch(() =>
        fail('RECEIPT_INVALID', 'Migration checkout is unavailable.'),
    );
    if (
        root !== c.migrationRepo ||
        path.basename(file) !== target.receiptFile ||
        run !== path.join(root, MIGRATION.runsDir, target.stack)
    )
        fail('RECEIPT_INVALID', 'Receipt is not in the owned canonical run directory.');
    await validateOwned(run, c);
    if (await lstat(path.join(run, target.lockFile)).catch(() => null))
        fail('LOCKED', 'Migration still has an unresolved execution lock.');
    const hashes = await snapshotIdentity(run, c, { after: true });
    if (canonical(hashes) !== canonical(receipt.snapshots))
        fail('SNAPSHOT_CHANGED', 'Migration snapshot files changed after verification.');
    return { status: 'verified', fingerprint: receipt.fingerprint, receipt: path.resolve(file) };
}
export async function executeMigration(c, phase, options = {}, deps = {}) {
    if (process.platform === 'win32')
        fail('UNSUPPORTED_PLATFORM', 'Execution requires macOS/Linux process-group cleanup.');
    //* v5 B24: every state name below comes from the matched registry entry.
    const target = migrationTarget(c);
    const RECEIPT = target.receiptFile,
        OWNER = target.ownerFile,
        LOCK = target.lockFile;
    rejectPlaceholders(c);
    if (phase === 'plan' && !options.allowSensitiveBackup)
        fail('BACKUP_CONSENT_REQUIRED', 'plan --execute requires --allow-sensitive-backup.');
    if (phase === 'remove' && options.confirmStack !== c.stack)
        fail('STACK_CONFIRMATION_REQUIRED', `remove --execute requires --confirm-stack ${target.stack}.`);
    const root = await (deps.validateRepository ?? validateRepository)(c);
    c = { ...c, migrationRepo: root };
    const run = path.join(root, MIGRATION.runsDir, target.stack),
        receiptFile = path.join(run, RECEIPT);
    await noSymlinkChain(root, MIGRATION.runsDir);
    let exists = await lstat(run).catch(() => null),
        state;
    if (!exists) {
        if (phase !== 'plan') fail('SEQUENCE_INVALID', 'Run plan first; no owned snapshot exists.');
        await mkdir(path.dirname(run), { recursive: true, mode: 0o700 });
        await mkdir(run, { mode: 0o700 });
        const owner = { schemaVersion: 1, tool: target.ownerTool, id: randomUUID(), fingerprint: fingerprint(c) };
        await atomic(path.join(run, OWNER), owner);
        state = {
            schemaVersion: 1,
            ownerId: owner.id,
            fingerprint: owner.fingerprint,
            config: c,
            status: 'ready',
            completed: [],
            steps: [],
            snapshots: {},
        };
        await saveReceipt(receiptFile, state);
    } else state = await validateOwned(run, c);
    if (state.status !== 'ready' || PHASES[state.completed.length] !== phase)
        fail('SEQUENCE_INVALID', 'Phase is out of order or the previous result needs manual reconciliation.');
    await deps.beforeLock?.();
    let lock;
    try {
        lock = await open(path.join(run, LOCK), 'wx', 0o600);
        await lock.writeFile(canonical({ pid: process.pid, phase, ownerId: state.ownerId }));
        await lock.close();
    } catch {
        fail('LOCKED', 'Migration run is locked; do not retry or remove the lock without reconciling state.');
    }
    try {
        state = await validateOwned(run, c);
        if (state.status !== 'ready' || PHASES[state.completed.length] !== phase)
            fail('SEQUENCE_INVALID', 'Phase advanced before the lock was acquired.');
    } catch (error) {
        await unlink(path.join(run, LOCK));
        throw error;
    }
    const start = performance.now(),
        step = { phase, status: 'in-flight', startedAt: new Date().toISOString(), boundary: 'sts-preflight' };
    state.status = 'in-flight';
    state.steps.push(step);
    await saveReceipt(receiptFile, state);
    const child = deps.runChild ?? runPrivateChild;
    const environment = targetEnvironment(c, deps.environment ?? process.env);
    let invoked = false;
    try {
        if (phase !== 'plan') {
            const hashes = await snapshotIdentity(run, c);
            const baseline = Object.fromEntries(Object.entries(state.snapshots).filter(([k]) => k !== 'after.json'));
            if (canonical(hashes) !== canonical(baseline))
                fail('SNAPSHOT_CHANGED', 'Backup files changed; migration cannot continue.');
        }
        const remaining = () => Math.max(1, c.timeoutMs - (performance.now() - start));
        if (performance.now() - start >= c.timeoutMs) fail('DEADLINE', 'Phase deadline reached before AWS execution.');
        const sts = await child({
            mode: 'sts',
            command: 'aws',
            args: [
                'sts',
                'get-caller-identity',
                '--profile',
                c.profile,
                '--region',
                c.region,
                '--output',
                'json',
                '--no-cli-pager',
            ],
            cwd: root,
            environment,
            timeoutMs: Math.min(remaining(), 30000),
            signal: options.signal,
        });
        if (sts.code !== 0 || sts.account !== c.account) {
            step.diagnostic = validateDiagnostic(sts.diagnostic);
            fail('ACCOUNT_MISMATCH', 'STS account could not be confirmed for the configured profile.');
        }
        if (performance.now() - start >= c.timeoutMs)
            fail('DEADLINE', 'Phase deadline reached before canonical migration.');
        const command = commandFor(c, phase, true);
        step.boundary = 'canonical-migration';
        await saveReceipt(receiptFile, state);
        invoked = true;
        const result = await child({
            mode: 'migration',
            command: command.args[0],
            args: command.args.slice(1),
            cwd: root,
            environment,
            timeoutMs: remaining(),
            signal: options.signal,
            onProgress: async value => {
                step.deployId = value.deployId;
                state.deployId = value.deployId;
                await saveReceipt(receiptFile, state);
            },
        });
        step.exitCode = result.code;
        if (result.code !== 0 || result.reason !== 'exited') {
            step.diagnostic = validateDiagnostic(result.diagnostic);
            fail(
                'PHASE_FAILED',
                'Canonical migration did not complete successfully; inspect private state before recovery.',
                true,
            );
        }
        const hashes = await snapshotIdentity(run, c, { after: phase === 'verify' });
        if (phase !== 'plan') {
            const baseline = Object.fromEntries(Object.entries(hashes).filter(([k]) => k !== 'after.json'));
            if (canonical(baseline) !== canonical(state.snapshots))
                fail('SNAPSHOT_CHANGED', 'Canonical phase changed its protected backup files.', true);
        }
        state.snapshots = hashes;
        state.completed.push(phase);
        state.status = phase === 'verify' ? 'completed' : 'ready';
        step.status = 'completed';
        step.finishedAt = new Date().toISOString();
        step.elapsedMs = performance.now() - start;
        await saveReceipt(receiptFile, state);
        await unlink(path.join(run, LOCK));
        return {
            status: state.status,
            phase,
            completed: state.completed,
            receipt: receiptFile,
            elapsedMs: step.elapsedMs,
        };
    } catch (error) {
        const unknown = invoked && (!['plan', 'verify'].includes(phase) || error?.unknown);
        state.status = unknown ? 'unknown' : 'blocked';
        step.status = state.status;
        step.errorCode = error instanceof MigrationError ? error.code : 'PRIVATE_STATE_FAILURE';
        step.finishedAt = new Date().toISOString();
        step.elapsedMs = performance.now() - start;
        try {
            await saveReceipt(receiptFile, state);
        } catch {}
        const wrapped = new MigrationError(
            step.errorCode,
            'Migration stopped; private receipt requires manual review before any further phase.',
            { unknown },
        );
        if (step.diagnostic) wrapped.diagnostic = validateDiagnostic(step.diagnostic);
        wrapped.receipt = receiptFile;
        wrapped.exitCode = unknown ? 3 : 1;
        throw wrapped;
    }
}
