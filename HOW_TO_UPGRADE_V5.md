# UPGRADE GUIDE: lemon-core V4 to V5

> Work in progress. This guide grows with each v5 bundle. This revision covers B1 (packaging).

---

## 1. Node.js 24

lemon-core v5 requires Node.js 24 (`engines.node >= 24.0.0`).

```bash
nvm install 24
nvm use 24
```

* Update `.nvmrc` to `24` (lemon-core uses `24.15.0`).

```diff
-  22.15.1
+  24.15.0
```

* `npm` only warns when `engines` does not match. Set `engine-strict=true` in your own `.npmrc` if you want the install to fail.
* The Lambda runtime of a deployed service is a separate change and is not part of this step.

---

## 2. ESM `import` and the env order

lemon-core is still built as CommonJS. v5 adds an ESM entry (`dist/esm/index.mjs`) that re-exports the same CommonJS module, so `import` and `require` give the **same instances** (`$engine`, the engine modules, the handlers).

```ts
// CommonJS (unchanged)
const { $engine, $U } = require('lemon-core');

// ESM
import { $engine, $U } from 'lemon-core';
import $core from 'lemon-core'; // { engine, cores, tools, controllers } - same as require('lemon-core').default
```

* In ESM, the default import is the root default export (`{ engine, cores, tools, controllers }`), the same object as `require('lemon-core').default`.
* Named ESM exports are copied once when lemon-core is loaded. Do not reassign lemon-core exports at run time.

**Env order.** lemon-core reads some env values while it is imported. In CommonJS you can set `process.env` before `require('lemon-core')`. In ESM, static `import` statements run before any code of the importing module, so you **cannot** set env values before a static `import 'lemon-core'`. Load the env first, then import lemon-core dynamically:

```js
// main.mjs
const { loadEnviron } = await import('lemon-core/dist/environ');
process.env = loadEnviron(process); // same loader as `require('lemon-core/dist/environ').default`
const { $engine } = await import('lemon-core');
```

* Any env loader works (for example `lemon-devkit`); what matters is that it runs before the first `import('lemon-core')`.

---

## 3. `exports` boundary and the `./dist/*` transition

v5 adds an `exports` map to `package.json`. With `exports`, Node resolves only the listed paths.

| Path | Use |
| --- | --- |
| `lemon-core` | root (CommonJS `require` or ESM `import`) |
| `lemon-core/testing` | test helpers (section 4) |
| `lemon-core/dist/environ` | compatibility (env loader) |
| `lemon-core/dist/cores/lambda/lambda-web-handler` | compatibility |
| `lemon-core/dist/extended/cores` | compatibility (directory path, listed explicitly) |
| `lemon-core/dist/*` | **transition only**: any other file under `dist/` |
| `lemon-core/package.json` | tools |

* **Transition pattern.** `lemon-core/dist/<file>` keeps working in v5 for any file (for example `lemon-core/dist/engine/builder`). This pattern **will be removed in v6**. Move deep imports to the root (`lemon-core`) or to a listed sub-path during v5.
* **Directory paths are blocked.** A deep path that relies on a directory `index` (for example `lemon-core/dist/extended`) is not resolved any more (`ERR_PACKAGE_PATH_NOT_EXPORTED` / `MODULE_NOT_FOUND`). Only `lemon-core/dist/extended/cores` is listed.
* **`moduleResolution: node` consumers are not affected.** TypeScript with `moduleResolution: node` (node10) ignores `exports` and keeps using `main` / `types`, which are unchanged. Node's own `require` does read `exports` at run time, so the rules above apply to the run time in every case.
* Types are one set (`dist/**/*.d.ts`) for both `import` and `require`.

Check your service:

```bash
grep -rn "lemon-core/dist" src | grep -v node_modules
```

---

## 4. `lemon-core/testing`

The test helpers have their own sub-path:

```ts
import { expect2, GETERR, waited } from 'lemon-core/testing';
```

* Exports: `GETERR`, `GETERR$`, `NUL404`, `onlyDefined`, `expect2`, `_it`, `environ`, `marshal`, `waited`, `asErrorPayload` (and the `Filter` type).
* The same helpers are still re-exported from the root (`import { expect2 } from 'lemon-core'`). Existing specs do not need a change.

---

## 5. Engine modules are registered once

`$engine.register(mod)` now ignores a module whose name (`getModuleName()`) is already registered and logs one info line (`! mod.reg(<name>) is already registered - ignored`). `$engine.module(name)` already returned the first one, so a single install sees no change.

If you see this line, lemon-core is probably installed twice (different versions or nested `node_modules`). Check with:

```bash
npm ls lemon-core
```

Fix the install so there is one copy. Two copies still mean two sets of globals.

---

## At-a-Glance Checklist

- [ ] Node.js 24 (`.nvmrc`, local runtime)
- [ ] ESM services: load env with `await import('lemon-core/dist/environ')` before `await import('lemon-core')`
- [ ] No directory deep imports (`lemon-core/dist/<dir>`); plan to remove file deep imports before v6
- [ ] Test helpers from `lemon-core/testing` (optional in v5)
- [ ] `npm ls lemon-core` shows one copy
