/**
 * `bin/lib/migrate-test-fixture.mjs` (lemon-core)
 * - test-only fixture of the migration specs (not shipped): a temp checkout + stubbed private children.
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/migrate-test-fixture.mjs` (`t.after` -> vitest `onTestFinished`).
import { onTestFinished } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { REVISION, TARGET, validateMigrationConfig, executeMigration, PHASES } from './migrate-core.mjs';
export async function fixture(t) {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'templates-migrate-test-')));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const repo = path.join(root, 'canonical');
    await mkdir(path.join(repo, 'scripts/migrate'), { recursive: true });
    const configFile = path.join(root, 'migration.json');
    const raw = {
        schemaVersion: 1,
        ...TARGET,
        migrationRepo: repo,
        migrationRevision: REVISION,
        region: 'ap-northeast-2',
        account: '234567890123',
        profile: 'local-fixture',
        endpoint: 'https://localfixture.execute-api.ap-northeast-2.amazonaws.com/dev',
        artifactBucket: '234567890123-deploy-artifacts',
        timeoutMs: 5000,
    };
    await writeFile(configFile, JSON.stringify(raw));
    const config = validateMigrationConfig(raw, configFile),
        run = path.join(repo, 'scripts/migrate/runs', TARGET.stack),
        calls = [];
    const deps = {
        validateRepository: async () => repo,
        runChild: async request => {
            calls.push(request);
            if (request.mode === 'sts') return { code: 0, reason: 'exited', account: config.account };
            if (request.args[0] === 'plan') await writeSnapshot(run, config);
            if (request.args[0] === 'verify')
                await writeFile(path.join(run, 'after.json'), await readFile(path.join(run, 'before.json')), {
                    mode: 0o600,
                });
            if (request.args[0] === 'apply') await request.onProgress?.({ deployId: 'dpl_mabc1234_abcdef' });
            return { code: 0, reason: 'exited' };
        },
    };
    return { root, repo, configFile, raw, config, run, calls, deps };
}
export async function writeSnapshot(run, c, { warnings = [] } = {}) {
    const bytes = Buffer.from('old deployed ZIP fixture'),
        hex = createHash('sha256').update(bytes).digest('hex'),
        base64 = Buffer.from(hex, 'hex').toString('base64');
    const names = [`${c.project}-dev-lambda`, `${c.project}-dev-backend`],
        env = Object.fromEntries(names.map(n => [n, { NAME: 'templates', SECRET: 'never-print-this-secret-value' }]));
    const functions = names.map((name, i) => ({
        name,
        runtime: c.runtime ?? 'nodejs24.x',
        handler: 'handler.lambda',
        memory: 512,
        timeout: i ? 300 : 30,
        codeSha: base64,
        esm: [],
        subs: [],
        rules: [],
    }));
    const plan = {
        stack: c.stack,
        project: c.project,
        stage: c.stage,
        artifactBucket: c.artifactBucket,
        kms: {
            ...(c.kmsDecryptKeyArn ? { decrypt: c.kmsDecryptKeyArn } : {}),
            ...(c.kmsEncryptKeyArn ? { encrypt: c.kmsEncryptKeyArn } : {}),
        },
        warnings,
        functions,
        codeFiles: { [base64]: `code/${hex}.zip` },
        api: { id: 'api123', routes: [], probes: ['/'] },
        keep: { logical: [], tables: [], queues: [], topics: [], buckets: [], logGroups: [] },
    };
    const before = {
        functions: Object.fromEntries(
            functions.map(f => [
                f.name,
                {
                    runtime: f.runtime,
                    handler: f.handler,
                    memory: f.memory,
                    timeout: f.timeout,
                    codeSha: f.codeSha,
                    envKeys: Object.keys(env[f.name]).sort(),
                },
            ]),
        ),
        api: { id: 'api123', routes: ['GET / NONE'], stages: ['dev'] },
        tables: {},
        queues: {},
        topics: {},
        buckets: {},
        logGroups: {},
        http: { '/': 200 },
    };
    await mkdir(path.join(run, 'code'), { mode: 0o700 });
    await writeFile(path.join(run, `code/${hex}.zip`), bytes, { mode: 0o600 });
    for (const [name, value] of Object.entries({ 'plan.json': plan, 'env.json': env, 'before.json': before }))
        await writeFile(path.join(run, name), JSON.stringify(value), { mode: 0o600 });
}
export async function allPhases(f) {
    let result;
    for (const phase of PHASES)
        result = await executeMigration(
            f.config,
            phase,
            { allowSensitiveBackup: true, confirmStack: TARGET.stack },
            f.deps,
        );
    return result;
}
