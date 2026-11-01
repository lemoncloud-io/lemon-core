#!/usr/bin/env node
/**
 * `bin/lemon-lambda-local.mjs` (lemon-core)
 * - run a packed artifact (or compiled handler dir) locally in cold/warm Node processes.
 * - usage: `lemon-lambda-local [options]` (installed bin) / `npx lemon-lambda-local --help`; run from the service root (`process.cwd()`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lambda-local.mjs` (behaviour, flags and output unchanged).
import { readFile } from 'node:fs/promises';
import { runLocal } from './lib/local-runner.mjs';

const help = `Usage: npm run lambda:local -- --artifact <pack-result-dir> --event <json-file> [options]
       npm run lambda:local -- --root <compiled-handler-dir> --event <json-file> [options]

--mode cold|warm       New process each run, or sequential module reuse (default cold)
--runs N               Number of identical invocations (default 1)
--timeout-ms N         Parent deadline per request including cold init (default 3000)
--handler-file FILE    Compiled handler file, relative to root
--handler-export NAME  Export name (root defaults to handler.js / lambda)
--env-file FILE        Explicit JSON object of string environment values
--function-name NAME  Context/environment function name (default lambda-local)
--function-version V  Context/environment version (default $LATEST)
--function-arn ARN    Context ARN (default synthetic local ARN)
--memory-size MB       Reported context setting only (default 128; no allocation)
--max-log-bytes N      Limit per stdout/stderr stream per run (default 65536)
--network deny|allow  Node development guard (default deny; not a sandbox)
--json                Print the complete schema v1 JSON report
--help                Show help

Trusted code only. Host credentials, HOME, NODE_OPTIONS and NODE_PATH are not inherited.
No Lambda IAM, VPC, CPU/memory allocation, freeze/thaw or cloud cold-start emulation.
`;
const flags = new Map([
    ['--artifact', 'artifact'],
    ['--root', 'root'],
    ['--event', 'eventFile'],
    ['--mode', 'mode'],
    ['--runs', 'runs'],
    ['--timeout-ms', 'timeoutMs'],
    ['--env-file', 'envFile'],
    ['--handler-file', 'handlerFile'],
    ['--handler-export', 'handlerExport'],
    ['--function-name', 'functionName'],
    ['--function-version', 'functionVersion'],
    ['--function-arn', 'functionArn'],
    ['--memory-size', 'memorySize'],
    ['--max-log-bytes', 'maxLogBytes'],
    ['--network', 'network'],
]);
try {
    const options = {};
    let json = false;
    for (let index = 2; index < process.argv.length; index++) {
        const flag = process.argv[index];
        if (flag === '--help') {
            console.log(help);
            process.exit(0);
        }
        if (flag === '--json') {
            json = true;
            continue;
        }
        const key = flags.get(flag);
        if (!key || index + 1 >= process.argv.length || process.argv[index + 1].startsWith('--'))
            throw new Error(`Unknown option or missing value: ${flag}`);
        if (options[key] !== undefined) throw new Error(`Duplicate option: ${flag}`);
        const value = process.argv[++index];
        options[key] = ['runs', 'timeoutMs', 'memorySize', 'maxLogBytes'].includes(key) ? Number(value) : value;
    }
    if (!options.eventFile) throw new Error('--event <json-file> is required');
    options.event = JSON.parse(await readFile(options.eventFile, 'utf8'));
    if (options.envFile) options.env = JSON.parse(await readFile(options.envFile, 'utf8'));
    if (options.handlerFile || options.handlerExport) {
        if (!options.handlerFile || !options.handlerExport)
            throw new Error('--handler-file and --handler-export must be supplied together');
        options.handler = { file: options.handlerFile, export: options.handlerExport };
    }
    const report = await runLocal(options);
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
        console.log(
            `lambda-local runner=node mode=${report.mode} network=${report.network} host=${report.host.platform}/${report.host.architecture} ${report.host.node}`,
        );
        for (const run of report.runs) {
            console.log(
                `${run.cold ? 'cold' : 'warm'} ${run.requestId} pid=${run.processId} ${
                    run.status
                } total=${run.timings.totalMs.toFixed(2)}ms`,
            );
            console.log(JSON.stringify(run.status === 'success' ? run.result : run.error, null, 2));
            if (run.stdout.text)
                console.log(`stdout${run.stdout.truncated ? ' (truncated)' : ''}:\n${run.stdout.text}`);
            if (run.stderr.text)
                console.log(`stderr${run.stderr.truncated ? ' (truncated)' : ''}:\n${run.stderr.text}`);
        }
    }
    process.exitCode = report.runs.every(run => run.status === 'success') ? 0 : 1;
} catch (error) {
    console.error(`lambda-local: ${error.message}`);
    process.exitCode = 2;
}
