#!/usr/bin/env node
/**
 * `bin/lemon-loop-check.mjs` (lemon-core)
 * - check the SNS / SQS / protocol loop test of the deployed service from its CloudWatch log lines.
 * - usage: `lemon-loop-check --stage dev --profile <name>` / `lemon-loop-check --kind sns`
 *   (or `npm run loop:check -- …` with `"loop:check": "lemon-loop-check"`); run in the service root.
 * - local: `lemon-loop-check --target express [--port <n>]` (server: `npm run express.lemon`, `LOCAL_TRANSPORT=mock`)
 * - all logic is in `lib/loop-check.mjs`; this file only sets the exit code.
 */
//* v5 B19: moved from lemon-templates-api `bin/loop-check.mjs` (snapshot d57dc5b).
import { run } from './lib/loop-check.mjs';

// run with the real transports; `run` never throws and returns the exit code.
run(process.argv.slice(2)).then(code => {
    process.exitCode = code;
});
