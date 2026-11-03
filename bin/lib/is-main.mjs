/**
 * `bin/lib/is-main.mjs` (lemon-core)
 * - true when the module of `url` is the process entry, also when started through an npm `bin` symlink.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

//* v5 B19: resolve `process.argv[1]` (maybe `node_modules/.bin/<name>` symlink) before comparing to `import.meta.url`.
export function isMain(url, argv1 = process.argv[1]) {
    if (!argv1) return false;
    try {
        return url === pathToFileURL(realpathSync(argv1)).href;
    } catch {
        // no such file (ex: `node -e`): not the entry.
        return false;
    }
}
