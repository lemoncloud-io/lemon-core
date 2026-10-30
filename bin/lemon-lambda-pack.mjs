#!/usr/bin/env node
/**
 * `bin/lemon-lambda-pack.mjs` (lemon-core)
 * - build a verified Lambda ZIP + manifest in Docker (no deployment, no AWS credentials).
 * - usage: `lemon-lambda-pack [options]` (installed bin) / `npx lemon-lambda-pack --help`; run from the service root (`process.cwd()`).
 */
//* v5 B19: ported from lemon-templates-api `bin/pack.mjs` (behaviour, flags and output unchanged).
import { parseArgs, pack } from './lib/pack-core.mjs';
const HELP = `Build a verified Lambda ZIP in Docker. No deployment or AWS credentials required.

Usage: npm run pack -- [options]
  --runtime nodejs24.x          Target runtime (only supported runtime)
  --architecture x86_64|arm64  Target architecture (default from config: x86_64)
  --output <directory>        New directory for lambda.zip and manifest.json
  --config <file>             Project JSON config (default: pack.config.json)
  --help, -h                  Show help

Requires Node >=24, Git and Docker with the selected Linux architecture available.
Builds from a safe source snapshot; host node_modules and dist are never reused.
Results are published only after ZIP extraction and offline handler export smoke.
See lemon-core docs/v5/B19-bin-deploy.md for scope, configuration, limits and reproducibility.`;
try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else {
        if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Host Node >=24 is required');
        await pack({ options });
    }
} catch (error) {
    console.error(`[pack] failed: ${error.message}`);
    process.exitCode = 1;
}
