#!/usr/bin/env node
/**
 * `bin/lemon-fields-admin.mjs` (lemon-core)
 * - check `GET /<type>/fields/admin` on the local express server or the deployed Lambda (`checkFieldsAdmin()`).
 * - usage: `lemon-fields-admin --target express` / `lemon-fields-admin --target lambda --stage dev`
 *   (or `npm run fields:admin -- …` with `"fields:admin": "lemon-fields-admin"`); run in the service root.
 * - all logic is in `lib/fields-admin.mjs`; this file only sets the exit code.
 */
//* v5 B19: moved from lemon-templates-api `bin/fields-admin.mjs` (snapshot d57dc5b).
import { run } from './lib/fields-admin.mjs';

// run with the real transports; `run` never throws and returns the exit code.
run(process.argv.slice(2)).then(code => {
    process.exitCode = code;
});
