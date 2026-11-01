#!/usr/bin/env node
/**
 * `bin/lemon-lambda-guard.mjs` (lemon-core)
 * - the migration guard of the reviewed targets: `init`, `register`, `status`, `resolve` (see `--help`).
 * - usage: `lemon-lambda-guard <command> [options]` (installed bin) / `npx lemon-lambda-guard --help`.
 */
//* v5 B31: new entry (logic in `lib/guard-cli.mjs`).
import { main } from './lib/guard-cli.mjs';
import { isMain } from './lib/is-main.mjs';

export { main };
//* v5 B31: run when started directly or through the npm `bin` symlink (`isMain` resolves `argv[1]`).
if (isMain(import.meta.url)) process.exitCode = await main();
