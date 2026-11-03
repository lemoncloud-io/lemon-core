/**
 * `bin/lib/fixtures/consumer.mjs` (lemon-core)
 * - a temp consumer service root for the specs of the invoke / observe tools (`serverless.yml`, `package.json`).
 * - test helper only: not in the published `files`.
 */
//* v5 B19: the tools read the service root from the process cwd; the specs point it at a temp dir like this.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

// service name and express port of the temp consumer.
export const SERVICE = 'demo-api';
export const PORT = 8800;

// make a temp service root with `serverless.yml`, `package.json` and extra `files` ({ path: text }).
export const makeConsumer = ({ service = SERVICE, port = PORT, files = {} } = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'lemon-b19-'));
    // the only line the tools read: the top-level `service:`.
    writeFileSync(join(root, 'serverless.yml'), `# temp consumer\nservice: ${service}\n\nprovider:\n  name: aws\n`);
    // `port` is read by the express targets.
    const pkg = { name: service, private: true, ...(port === null ? {} : { port }) };
    writeFileSync(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    // extra files (fixtures) under the root.
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    }
    return { root, done: () => rmSync(root, { recursive: true, force: true }) };
};
