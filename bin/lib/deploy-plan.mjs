import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareSource } from './local-artifact.mjs';
import { sha256 } from './pack-zip.mjs';
import { ORG_DEFAULTS } from './org-defaults.mjs';

//* v5 B19: the deploy-service pins come from `org-defaults.mjs` (values unchanged).
const DEPLOY = ORG_DEFAULTS.deploy;

export class DeployError extends Error {
    constructor(code, message, { unknown = false } = {}) {
        super(message);
        this.name = 'DeployError';
        this.code = code;
        this.unknown = unknown;
    }
}
export const invalid = field => {
    throw new DeployError('INVALID_INPUT', `Invalid ${field}; see ${DEPLOY.docRef}`);
};
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function keysOnly(value, keys, field) {
    if (!isObject(value) || Object.keys(value).some(k => !keys.includes(k))) invalid(field);
}
export async function readJson(file, field = 'JSON file') {
    try {
        return JSON.parse(await readFile(file, 'utf8'));
    } catch {
        invalid(field);
    }
}
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const token = (value, re, field) => {
    if (typeof value !== 'string' || !re.test(value)) invalid(field);
    return value;
};
export const DEFAULT_HEADERS = [
    'Content-Type',
    'X-Amz-Date',
    'Authorization',
    'X-Api-Key',
    'X-Amz-Security-Token',
    'X-Amz-User-Agent',
    'X-Amzn-Trace-Id',
];
export const CUSTOM_HEADERS = [
    'Authorization',
    'Content-Type',
    'X-Amz-Date',
    'X-Amz-Security-Token',
    'X-Amz-User-Agent',
    'X-Api-Key',
    'X-Lemon-Language',
    'X-Lemon-Identity',
];
export function validateConfig(raw) {
    keysOnly(
        raw,
        [
            'schemaVersion',
            'mode',
            'project',
            'stage',
            'region',
            'account',
            'endpoint',
            'profile',
            'artifactBucket',
            'keyPrefix',
            'environmentFile',
            'policy',
            'routes',
            'deletionProtection',
            'functions',
            'queue',
            'usagePlan',
            'expect',
            'requestTimeoutMs',
            'pollIntervalMs',
            'maxPolls',
            'routeDelayMs',
        ],
        'config keys',
    );
    if (raw.schemaVersion !== 1 || !['code', 'bootstrap'].includes(raw.mode)) invalid('schemaVersion/mode');
    const c = { ...raw };
    token(c.project, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-api$/, 'project');
    if (c.project.length > 40 || c.project.startsWith(DEPLOY.reservedProjectPrefix)) invalid('project');
    if (!['dev', 'prod'].includes(c.stage)) invalid('stage');
    token(c.region, /^[a-z]{2}(?:-[a-z]+)+-\d$/, 'region');
    token(c.account, /^\d{12}$/, 'account');
    let u;
    try {
        u = new URL(c.endpoint);
    } catch {
        invalid('endpoint');
    }
    if (
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        u.port ||
        !new RegExp(`^[a-z0-9]+\\.execute-api\\.${c.region}\\.amazonaws\\.com$`).test(u.hostname) ||
        !/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)
    )
        invalid('endpoint');
    c.endpoint = u.href.replace(/\/$/, '');
    if (c.profile !== undefined) token(c.profile, /^[A-Za-z0-9_.@-]{1,128}$/, 'profile');
    token(c.artifactBucket, BUCKET_RE, 'artifactBucket');
    if (
        c.artifactBucket.includes('..') ||
        c.artifactBucket.includes('.-') ||
        c.artifactBucket.includes('-.') ||
        /^\d+\.\d+\.\d+\.\d+$/.test(c.artifactBucket)
    )
        invalid('artifactBucket');
    token(c.keyPrefix, /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/, 'keyPrefix');
    if (c.keyPrefix.length > 800) invalid('keyPrefix');
    for (const [k, d, min, max] of [
        ['requestTimeoutMs', 35000, 1000, 60000],
        ['pollIntervalMs', 2000, 250, 10000],
        ['maxPolls', 120, 1, 300],
        ['routeDelayMs', 1500, 1000, 10000],
    ]) {
        c[k] ??= d;
        if (!Number.isInteger(c[k]) || c[k] < min || c[k] > max) invalid(k);
    }
    if (c.expect !== undefined && (typeof c.expect !== 'string' || !c.expect.trim() || c.expect.length > 32768))
        invalid('expect');
    c.policy ??= {};
    keysOnly(
        c.policy,
        [
            'kmsKeyArn',
            'kmsDecryptKeyArn',
            'kmsEncryptKeyArn',
            'identityPoolId',
            'bucket',
            'objectScopes',
            'extraStatements',
        ],
        'policy',
    );
    for (const [k, v] of Object.entries(c.policy)) {
        if (k.endsWith('Arn'))
            token(v, new RegExp(`^arn:aws:kms:${c.region}:${c.account}:key/[a-zA-Z0-9-]+$`), `policy.${k}`);
        if (k === 'identityPoolId') token(v, new RegExp(`^${c.region}:[a-f0-9-]{36}$`), 'policy.identityPoolId');
        if (k === 'bucket') token(v, BUCKET_RE, 'policy.bucket');
    }
    //* the fixed keys above + two custom paths. The real ceiling is the deploy service (tool +
    //* boundary); here only the SHAPE is checked, and `extraStatements` region/account is `assertPolicy`'s.
    if (c.policy.objectScopes !== undefined) validateObjectScopes(c.policy.objectScopes);
    if (c.policy.extraStatements !== undefined) validateStatements(c.policy.extraStatements);
    if (c.functions !== undefined) {
        keysOnly(c.functions, ['lambda', 'backend'], 'functions');
        for (const [k, f] of Object.entries(c.functions)) {
            keysOnly(f, ['timeout', 'memorySize'], `functions.${k}`);
            if (f.timeout !== undefined && !(Number.isInteger(f.timeout) && f.timeout >= 1 && f.timeout <= 900))
                invalid(`functions.${k}.timeout`);
            if (
                f.memorySize !== undefined &&
                !(Number.isInteger(f.memorySize) && f.memorySize >= 128 && f.memorySize <= 1024)
            )
                invalid(`functions.${k}.memorySize`);
        }
    }
    if (c.queue !== undefined) {
        keysOnly(c.queue, ['visibilityTimeout'], 'queue');
        if (Number(token(c.queue.visibilityTimeout, /^\d{1,5}$/, 'queue.visibilityTimeout')) > 43200)
            invalid('queue.visibilityTimeout');
    }
    //* AWS refuses an SQS mapping whose queue visibility is below the backend timeout — checked on the
    //* EFFECTIVE values, so raising `functions.backend.timeout` alone fails here, not mid-round.
    if (Number(queueAttributes(c).VisibilityTimeout) < functionShapes(c)[1].timeout)
        invalid('queue.visibilityTimeout (must be >= functions.backend.timeout)');
    if (c.mode === 'bootstrap') {
        if (typeof c.environmentFile !== 'string' || !c.environmentFile) invalid('environmentFile');
        if (typeof c.deletionProtection !== 'boolean') invalid('deletionProtection');
        if (!Array.isArray(c.routes) || !c.routes.length || c.routes.length > 100) invalid('routes');
        const seen = new Set();
        for (const r of c.routes) {
            keysOnly(r, ['path', 'httpMethod', 'authorizationType', 'cors', 'apiKeyRequired'], 'route');
            if (r.apiKeyRequired !== undefined && typeof r.apiKeyRequired !== 'boolean')
                invalid('route.apiKeyRequired');
            if (typeof r.path !== 'string' || !r.path.startsWith('/')) invalid('route.path');
            const segments = r.path === '/' ? [] : r.path.slice(1).split('/');
            if (
                segments.some(
                    (part, i) =>
                        !/^(?:[A-Za-z0-9._-]+|\{[A-Za-z0-9_]+\+?\})$/.test(part) ||
                        part === '.' ||
                        part === '..' ||
                        (part.includes('+') && i !== segments.length - 1),
                )
            )
                invalid('route.path');
            if (r.path.split('/').some((s, i, a) => s === '.' || s === '..' || (s.includes('+') && i !== a.length - 1)))
                invalid('route.path');
            if (
                !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(r.httpMethod) ||
                !['NONE', 'AWS_IAM'].includes(r.authorizationType)
            )
                invalid('route method/auth');
            const id = `${r.httpMethod} ${r.path}`;
            if (seen.has(id)) invalid('duplicate route');
            seen.add(id);
            keysOnly(r.cors, ['origin', 'headers', 'credentials', 'allowCredentialsWithWildcardOrigin'], 'route.cors');
            if (
                !Array.isArray(r.cors.headers) ||
                !r.cors.headers.every(h => typeof h === 'string' && /^[A-Za-z0-9-]+$/.test(h)) ||
                typeof r.cors.credentials !== 'boolean'
            )
                invalid('route.cors');
            if (r.cors.origin !== '*' && !/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(r.cors.origin))
                invalid('route.cors.origin');
            if (r.cors.origin !== '*') {
                try {
                    if (new URL(r.cors.origin).origin !== r.cors.origin) invalid('route.cors.origin');
                } catch {
                    invalid('route.cors.origin');
                }
            }
            if (
                r.cors.allowCredentialsWithWildcardOrigin !== undefined &&
                typeof r.cors.allowCredentialsWithWildcardOrigin !== 'boolean'
            )
                invalid('route.cors opt-in');
            if (r.cors.origin === '*' && r.cors.credentials && r.cors.allowCredentialsWithWildcardOrigin !== true)
                invalid('route.cors wildcard credentials opt-in');
        }
        if (!c.routes.some(r => r.path === '/' && r.httpMethod === 'GET' && r.authorizationType === 'NONE'))
            invalid('public GET / route');
        //* an api-key route without a usage plan can never be called, and a plan without one is pointless.
        const keyed = c.routes.some(r => r.apiKeyRequired === true);
        if (keyed !== (c.usagePlan !== undefined))
            invalid('usagePlan (required exactly when a route is apiKeyRequired)');
        if (c.usagePlan !== undefined) validateUsagePlan(c.usagePlan);
    } else if (
        c.environmentFile !== undefined ||
        c.deletionProtection !== undefined ||
        c.routes !== undefined ||
        c.functions !== undefined ||
        c.queue !== undefined ||
        c.usagePlan !== undefined ||
        Object.keys(c.policy).length
    )
        invalid('bootstrap-only config in code mode');
    return c;
}
const validateObjectScopes = scopes => {
    if (!Array.isArray(scopes) || !scopes.length || scopes.length > 10) invalid('policy.objectScopes');
    for (const s of scopes) {
        keysOnly(s, ['bucket', 'prefix', 'actions'], 'policy.objectScopes[]');
        token(s.bucket, BUCKET_RE, 'policy.objectScopes[].bucket');
        if (
            s.prefix !== undefined &&
            token(s.prefix, /^[A-Za-z0-9!_.*'()/-]{1,512}$/, 'policy.objectScopes[].prefix').includes('..')
        )
            invalid('policy.objectScopes[].prefix');
        const a = s.actions;
        if (!Array.isArray(a) || !a.length || a.some(x => !['get', 'put'].includes(x)) || new Set(a).size !== a.length)
            invalid('policy.objectScopes[].actions');
    }
};
const validateStatements = statements => {
    if (!Array.isArray(statements) || !statements.length || statements.length > 20) invalid('policy.extraStatements');
    for (const S of statements) {
        //* the same four keys `lemon.deploy.ensure-role@1` accepts; Deny/Condition/NotAction are out.
        //* Effect + Resource account/region: the runner's `assertPolicy` (before begin) checks every statement.
        keysOnly(S, ['Sid', 'Effect', 'Action', 'Resource'], 'policy.extraStatements[]');
        if (S.Sid !== undefined) token(S.Sid, /^[A-Za-z0-9]{1,128}$/, 'policy.extraStatements[].Sid');
        const actions = typeof S.Action === 'string' ? [S.Action] : S.Action;
        if (!Array.isArray(actions) || !actions.length || actions.some(a => !/^[a-z0-9-]+:[A-Za-z*]+$/.test(a)))
            invalid('policy.extraStatements[].Action');
    }
};
const validateUsagePlan = u => {
    keysOnly(u, ['name', 'keyIds', 'throttle', 'quota'], 'usagePlan');
    if (u.name !== undefined) token(u.name, /^[A-Za-z0-9_-]{1,128}$/, 'usagePlan.name');
    if (
        u.keyIds !== undefined &&
        (!Array.isArray(u.keyIds) ||
            u.keyIds.length > 50 ||
            u.keyIds.some(id => typeof id !== 'string' || !/^[a-z0-9]{10}$/.test(id)) ||
            new Set(u.keyIds).size !== u.keyIds.length)
    )
        invalid('usagePlan.keyIds');
    if (u.throttle !== undefined) {
        keysOnly(u.throttle, ['rateLimit', 'burstLimit'], 'usagePlan.throttle');
        if (!(u.throttle.rateLimit >= 0) || !Number.isInteger(u.throttle.burstLimit) || u.throttle.burstLimit < 0)
            invalid('usagePlan.throttle');
    }
    if (u.quota !== undefined) {
        keysOnly(u.quota, ['limit', 'period'], 'usagePlan.quota');
        if (!Number.isInteger(u.quota.limit) || u.quota.limit < 1 || !['DAY', 'WEEK', 'MONTH'].includes(u.quota.period))
            invalid('usagePlan.quota');
    }
};
export async function loadDeployment({ configFile, artifact }) {
    const config = validateConfig(await readJson(configFile, 'config JSON'));
    let environment = {};
    if (config.mode === 'bootstrap') {
        environment = await readJson(
            path.resolve(path.dirname(configFile), config.environmentFile),
            'environment JSON',
        );
        if (
            !isObject(environment) ||
            Object.entries(environment).some(([k, v]) => !/^[A-Za-z][A-Za-z0-9_]+$/.test(k) || typeof v !== 'string')
        )
            invalid('environment string map');
        if (Object.values(environment).some(v => v.startsWith('*AQIC')) && !config.policy.kmsDecryptKeyArn)
            invalid('policy.kmsDecryptKeyArn for encrypted environment');
    }
    let prepared;
    try {
        prepared = await prepareSource({ artifact });
    } catch {
        invalid('pack artifact integrity');
    }
    try {
        if (prepared.source.runtime !== 'nodejs24.x' || prepared.source.architecture !== 'x86_64')
            invalid('artifact runtime/architecture (requires nodejs24.x/x86_64)');
        const manifestBytes = await readFile(path.join(artifact, 'manifest.json'));
        if (sha256(manifestBytes) !== prepared.source.manifestSha256) invalid('manifest changed during validation');
        const manifest = JSON.parse(manifestBytes);
        if (manifest.archive.bytes > 50000000) invalid('ZIP size (deploy API maximum 50,000,000 bytes)');
        const bytes = await readFile(path.join(artifact, manifest.archive.file));
        if (
            bytes.length !== manifest.archive.bytes ||
            sha256(bytes) !== prepared.source.archiveSha256 ||
            sha256(await readFile(path.join(artifact, 'manifest.json'))) !== prepared.source.manifestSha256
        )
            invalid('artifact changed during validation');
        return {
            config,
            environment,
            artifact: {
                bytes,
                sha256: prepared.source.archiveSha256,
                manifestSha256: prepared.source.manifestSha256,
                fileCount: prepared.source.fileCount,
                handler: `${prepared.handler.file.replace(/\.(?:c?js|mjs)$/, '')}.${prepared.handler.export}`,
                source: {
                    gitSha:
                        typeof manifest.source?.git?.sha === 'string'
                            ? manifest.source.git.sha
                            : manifest.source?.gitSha ?? null,
                    dirty: manifest.source?.git?.dirty ?? manifest.source?.dirty ?? null,
                },
            },
        };
    } finally {
        await prepared.cleanup();
    }
}
export const QUEUE_ATTRIBUTES = Object.freeze({
    MessageRetentionPeriod: '1800',
    VisibilityTimeout: '300',
    MaximumMessageSize: '4096',
    DelaySeconds: '3',
    ReceiveMessageWaitTimeSeconds: '20',
});
export const TABLE_SHAPE = Object.freeze({
    attributeDefinitions: [{ attributeName: '_id', attributeType: 'S' }],
    keySchema: [{ attributeName: '_id', keyType: 'HASH' }],
    billingMode: 'PAY_PER_REQUEST',
    stream: { viewType: 'NEW_AND_OLD_IMAGES' },
});
export const FUNCTION_SHAPES = Object.freeze([
    { memorySize: 512, timeout: 30 },
    { memorySize: 512, timeout: 300 },
]);
//* the shapes this config deploys — `FUNCTION_SHAPES` unless `functions.<component>` overrides a field.
export const functionShapes = c =>
    FUNCTION_SHAPES.map((shape, i) => ({ ...shape, ...c.functions?.[i ? 'backend' : 'lambda'] }));
//* the queue attributes — `QUEUE_ATTRIBUTES` unless `queue.visibilityTimeout` is set.
export const queueAttributes = c =>
    c.queue ? { ...QUEUE_ATTRIBUTES, VisibilityTimeout: c.queue.visibilityTimeout } : QUEUE_ATTRIBUTES;
//* v5 B24: the two functions a deployment targets — the deploy service's sls rule `<project>-<stage>-<component>`.
export const plannedFunctionNames = c =>
    Object.freeze({ lambda: `${c.project}-${c.stage}-lambda`, backend: `${c.project}-${c.stage}-backend` });
export const LOG_RETENTION_DAYS = 14;
export const SCHEDULE = Object.freeze({
    scheduleExpression: 'cron(0/1 * * * ? *)',
    state: 'DISABLED',
    description: 'run every minute to keep alive',
});
export function deploymentPlan({ config: c, environment, artifact: a }) {
    const source = a.source ?? {};
    return {
        schemaVersion: 1,
        mode: c.mode,
        execution: 'offline-plan',
        target: { project: c.project, stage: c.stage, account: c.account, region: c.region, endpoint: c.endpoint },
        artifact: {
            sha256: a.sha256,
            manifestSha256: a.manifestSha256,
            bytes: a.bytes.length,
            fileCount: a.fileCount,
            runtime: 'nodejs24.x',
            architecture: 'x86_64',
            handler: a.handler,
            bucket: c.artifactBucket,
            key: `${c.keyPrefix}/${a.sha256}.zip`,
            source: {
                gitSha: /^[a-f0-9]{40}$/.test(source.gitSha) ? source.gitSha : null,
                dirty: typeof source.dirty === 'boolean' ? source.dirty : null,
            },
        },
        environmentKeys:
            c.mode === 'bootstrap'
                ? [
                      ...new Set([
                          ...Object.keys(environment),
                          'STAGE',
                          'DEFAULT_REGION',
                          'MY_DYNAMO_TABLE',
                          'MY_SQS_ENDPOINT',
                          'MY_SNS_ENDPOINT',
                      ]),
                  ].sort()
                : [],
        verification: {
            event: 'API Gateway GET /',
            expectedPayloadConfigured: c.expect !== undefined,
            ...(c.expect === undefined ? {} : { expectedPayloadSha256: sha256(c.expect) }),
            serverEvidence: 'aggregate verified only',
            ...(c.mode === 'bootstrap'
                ? {
                      publicProbe: { method: 'GET', path: '/', expectStatus: 200 },
                      additionalPublicProbe: c.routes.some(
                          r => r.path === '/hello/{id}' && r.httpMethod === 'GET' && r.authorizationType === 'NONE',
                      )
                          ? '/hello/0'
                          : null,
                  }
                : {}),
        },
        ...(c.mode === 'bootstrap'
            ? {
                  configuration: {
                      policy: { profile: DEPLOY.policyProfile, ...c.policy },
                      table: { ...TABLE_SHAPE, deletionProtection: c.deletionProtection },
                      queue: { attributes: queueAttributes(c) },
                      functions: functionShapes(c).map((shape, i) => ({
                          component: i ? 'backend' : 'lambda',
                          runtime: 'nodejs24.x',
                          architecture: 'x86_64',
                          handler: a.handler,
                          ...shape,
                          environmentMode: 'merge',
                      })),
                      logRetentionDays: LOG_RETENTION_DAYS,
                      schedule: { ...SCHEDULE, input: { cron: { name: '1MIN', stage: c.stage } } },
                      routes: c.routes,
                      ...(c.usagePlan ? { usagePlan: c.usagePlan } : {}),
                  },
              }
            : {
                  configuration: {
                      changes:
                          'Code only; role is reasserted from live preflight. No environment/runtime/handler/memory/timeout changes.',
                  },
              }),
        steps: [
            'resolve-names (lemon / sls / backend)',
            'resolve-policy + account/region cross-check',
            `read Lambda configuration/tags (${c.mode === 'code' ? 'must exist' : 'absence allowed'})`,
            'deploy.begin',
            'presign-put → conditional ZIP PUT',
            ...(c.mode === 'bootstrap'
                ? [
                      'ensure-role',
                      'table / queue / topic',
                      'log groups ×2',
                      'functions ×2 + verification',
                      'SNS / DynamoDB stream / SQS mappings',
                      'disabled schedule',
                      `REST API / ${c.routes.length} sequential routes / stage probe`,
                      ...(c.usagePlan ? ['usage plan + api keys'] : []),
                  ]
                : ['existing functions ×2 code + verification']),
            'deploy.end',
        ],
        limitations: [
            'Offline plan does not attest cloud state or permission.',
            'Both apply modes require lambda:GetFunctionConfiguration and lambda:ListTags in addition to execute-api:Invoke.',
            'No atomic update-only server contract: a deletion after preflight can race with ensure-function.',
            'Server exposes aggregate verified, not individual verification checks.',
            ...(c.expect === undefined
                ? ['Function invoke-ok does not prove an application HTTP 200; no exact expected payload supplied.']
                : []),
        ],
    };
}
