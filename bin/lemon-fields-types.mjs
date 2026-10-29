#!/usr/bin/env node
/**
 * `bin/lemon-fields-types.mjs` (lemon-core)
 * - check that one field name has one type across the stored models of one OpenSearch index (`$FIELD` models).
 * - usage: `lemon-fields-types [options]` (installed bin) / `npx lemon-fields-types` / `npm run fields:types -- [options]`.
 * - all logic is in `lib/fields-types.mjs`; this file only sets the exit code.
 */
//* v5 B10-5: the CLI entry of the shared field-type checker (ported from lemon-templates-api `bin/fields-types.mjs`).
import { run } from './lib/fields-types.mjs';

// run on the real file system; `run` never throws and returns the exit code.
process.exitCode = run(process.argv.slice(2));
