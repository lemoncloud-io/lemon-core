#!/usr/bin/env node
/**
 * `scripts/aws-lazy-probe.cjs`
 * - v5 B2-c load probe (SPEC § 3.5.9 gate 2): importing lemon-core loads no AWS SDK module.
 * - each entry point is required in a fresh child process (clean `require.cache`), then the cache is counted:
 *   total modules and the files under `/@aws-sdk/`, `/@smithy/`, `/@aws-crypto/`, `/@aws/`.
 * - then, in the `dist/index` process: `$U.NS('x')` (still 0), and `AWSKMSService.instance()`
 *   (construction only, no `send`, no AWS env) → which `@aws-sdk/*` packages got loaded; then once more
 *   with a dummy profile name (the provider is built, never called) → `credential-providers` too.
 * - `dist/tools` has no `$U`, so its NS step loads `dist/engine` for it (the `import` line is the gate).
 * - prints counts and package names only: no env values, no hosts, no paths.
 *
 * usage (clean env):
 * ```sh
 * $ npm run build
 * $ env -i PATH=$PATH HOME=$HOME node scripts/aws-lazy-probe.cjs
 * ```
 */
const path = require('path');
const { execFileSync } = require('child_process');

// the entry points to check (relative to the repo root).
const ENTRIES = ['dist/index', 'dist/engine', 'dist/tools', 'dist/helpers'];

// the child body: count `require.cache` after each step and print one JSON line (runs with `-e`).
const CHILD = `
const path = require('path');
const sep = path.sep;
// counts of the loaded modules: total, and per AWS owner scope.
const count = () => {
    const keys = Object.keys(require.cache);
    const has = s => keys.filter(k => k.includes(sep + s + sep)).length;
    return { total: keys.length, awsSdk: has('@aws-sdk'), smithy: has('@smithy'), awsCrypto: has('@aws-crypto'), aws: has('@aws') };
};
// the loaded '@aws-sdk/<name>' package names by owner (the last '@aws-sdk/' in the path; sorted, unique).
const sdkPackages = () => [...new Set(Object.keys(require.cache)
    .map(k => k.split(sep + '@aws-sdk' + sep).slice(1).pop())
    .filter(Boolean)
    .map(rest => rest.split(sep)[0]))].sort();
const root = process.argv[1];
const entry = process.argv[2];
const out = { entry };
// 1. import the entry point.
const mod = require(path.join(root, entry));
out.import = count();
// 2. the namespace helper of the engine (\`$U\`).
const $U = mod.$U || (mod.default && mod.default.engine && mod.default.engine.U) || require(path.join(root, 'dist/engine')).$U;
$U.NS('x');
out.ns = count();
// 3. (dist/index only) build the KMS client: construction only, no send, no profile.
if (process.argv[3] === 'kms') {
    const { AWSKMSService } = require(path.join(root, 'dist/cores/aws/aws-kms-service'));
    new AWSKMSService().instance();
    out.kms = count();
    out.kmsPackages = sdkPackages();
    // 4. the same with a profile name set (a dummy name: \`fromIni\` is built, never called) → credential-providers.
    process.env.NAME = 'aws-lazy-probe';
    new AWSKMSService().instance();
    out.kmsProfile = count();
    out.kmsProfilePackages = sdkPackages();
}
process.stdout.write('\\n' + JSON.stringify(out));
`;

// run one entry point in a fresh child process (same env; logs are dropped).
const probe = (entry, extra) =>
    JSON.parse(
        execFileSync(process.execPath, ['-e', CHILD, path.resolve(__dirname, '..'), entry, ...(extra ? [extra] : [])], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        })
            .trim()
            .split('\n')
            .pop(),
    );

// format the counts of one step.
const fmt = c => `total=${c.total} @aws-sdk=${c.awsSdk} @smithy=${c.smithy} @aws-crypto=${c.awsCrypto} @aws=${c.aws}`;

// probe every entry point; the KMS step runs in the `dist/index` process.
for (const entry of ENTRIES) {
    const r = probe(entry, entry === 'dist/index' ? 'kms' : '');
    console.log(`${entry} import: ${fmt(r.import)}`);
    console.log(`${entry} after-NS: ${fmt(r.ns)}`);
    if (r.kms) {
        console.log(`${entry} after-kms-instance: ${fmt(r.kms)}`);
        // the `client-*` packages, then every loaded `@aws-sdk/*` package.
        console.log(`kms clients: ${r.kmsPackages.filter(p => p.startsWith('client-')).join(',')}`);
        console.log(`kms packages(${r.kmsPackages.length}): ${r.kmsPackages.join(',')}`);
        // with a (dummy) profile name: `awsConfig()` also loads `credential-providers`.
        console.log(`${entry} after-kms-instance-with-profile: ${fmt(r.kmsProfile)}`);
        console.log(`kms+profile clients: ${r.kmsProfilePackages.filter(p => p.startsWith('client-')).join(',')}`);
        console.log(
            `kms+profile has credential-providers: ${r.kmsProfilePackages.includes('credential-providers')} packages=${
                r.kmsProfilePackages.length
            }`,
        );
    }
}
