# UPGRADE GUIDE: lemon-core V3 to V4

---

## 0. Update lemon-core Version

```sh
npm install lemon-core --save
```

## 1. Upgrade Node.js Version

```bash
nvm install 22
nvm use 22
```

* Update `.nvmrc` file to `22`

```diff
-  18.19.1
+  22.15.1
```

* Update `config.js` Node.js runtime version of your profile

```diff
         lemon: {
            name: 'lemon-app',
-            runtime: 'nodejs18.x', // Powered by the V8 JavaScript Engine (used in Chromium)
+            runtime: 'nodejs22.x',
        },
```

> ### Note
>
> When running `npm run deploy` in a Node.js 22, you may encounter the following error:
>
> ```bash
> Error [ERR_REQUIRE_ASYNC_MODULE]: require() cannot be used on an ESM graph with top-level await. Use import() instead. To see where the top-level await comes from, use --experimental-print-required-tla.
> ```
>
> In this case:
>
> * Set only the Lambda runtime (Node.js version) to 22 in your `serverless.yml`.
> * Execute the deployment command (`npm run deploy`) in a **Node.js 18 (nvm 18)**.

## 2. Install `lemon-devkit`

* Add as a `devDependency`:

  ```bash
  npm install --save-dev lemon-devkit
  ```

---

### package.json Key Changes

```diff
 {
   "engines": {
-    "node": ">=14",
+    "node": ">=22"
   },
   "dependencies": {
-    "lemon-core": "^3.x",
+     "lemon-core": "^4.x",
   },
   "devDependencies": {
+    "lemon-devkit": "^0.0.3",
     "typescript": "^4.x",
     "jest": "^29.x"
   }
 }
```

---

## 3. AWS SDK: v2 to v3 Migration

1. **Credential Management**

   * Replace legacy `credentials` approach with `asyncCredentials()` from `lemon-core`.

   * Example:

     ```ts
     import { asyncCredentials } from 'lemon-core';
     const credentials = await asyncCredentials(PROFILE);
     ```

   * **\[Test Updates]**

     * If you use `loadProfile(process)` to set up environment variables, move it **inside `it()` blocks** and `await` the call

       ```ts
       it('should initialize credentials', async () => {
         const PROFILE = await loadProfile(process);
         const credentials = await asyncCredentials(PROFILE);
         expect(credentials).toBeDefined();
       });
       ```

2. **Client Initialization**

   * Use `awsConfig($engine, region)` for initializing v3 clients.
   * Example:

     ```ts
     import { SQSClient } from '@aws-sdk/client-sqs';
     import $engine, { awsConfig } from 'lemon-core';

     async function createSqsClient() {
       const region = 'ap-northeast-2';
       return new SQSClient(awsConfig($engine, region));
     }
     ```


---

## At-a-Glance Checklist

* [ ] **Upgrade lemon-core**
* [ ] **Upgrade to Node.js 22**
  * Change `nvm` version, update `.nvmrc`
  * Change node.js runtime version of your profile, update `config.js`
  * When using Node.js 22, `npm run deploy` may fail due to module loading errors.
      For deployment, use Node.js 18 instead.
* [ ] **Install lemon-devkit** (devDependency)
* [ ] **Review AWS SDK v3 migration changes**

  * **Credentials**: Replace old `credentials` code with `asyncCredentials()`
  * **Client Initialization**: Use `awsConfig($engine, region)`
* [ ] **Review CI/CD environments**

  * Ensure Node.js 22 is set in `serverless.yml`, `Dockerfile`, etc.

---
