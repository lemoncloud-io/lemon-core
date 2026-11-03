/**
 * `bin/lib/guard-test-seal.mjs` (lemon-core)
 * - vitest setup file (test-only, not shipped): seals the migration guard of every spec from the real machine.
 * - `LEMON_MIGRATION_GUARD_INSTALL` is set to an absolute temp path that does not exist, so a test that reaches the
 *   guard with `process.env` never reads `~/.lemon-core`; a test that passes its own `guardEnv` / `env` keeps it.
 */
//* v5 B31 r2 (S3): new setup file (`vitest.config.ts` `setupFiles`).
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

//* v5 B31 r2: a fresh, never-created path per test file (an applicable target is `blocked: install-invalid`).
process.env.LEMON_MIGRATION_GUARD_INSTALL = path.join(
    os.tmpdir(),
    `lemon-guard-sealed-${randomUUID()}`,
    'migration-guard.install.json',
);
