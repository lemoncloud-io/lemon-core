# UPGRADE GUIDE: lemon-core V3 to V4

---

## 0. Update lemon-core Version

```sh
npm install lemon-core@^4.0.5 --save
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

* Update plugins in serverless.yml

```diff
  plugins:
    - serverless-offline
-   - serverless-offline
+   #WARN - failure in nodejs 22.x due to `serverless-offline` plugin @250627
+   # - serverless-offline
    - serverless-aws-documentation
    - serverless-prune-plugin
    - serverless-plugin-log-retention
```

> ### Note
>
> If you **don’t modify the `plugins` section** in `serverless.yml`, you may encounter the following issues:
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

   * **\[express.ts Updates]**

    ```diff
      //! dynamic loading credentials by profile. (search PROFILE -> NAME)
      export const credentials = async (name?: string) => {
          _log(NS, `credentials(${name})..`);
          const NAME = name || ($engine.environ('NAME', '') as string);
          const profile = $engine.environ('PROFILE', NAME) as string;
    -      return $core.tools.credentials(profile);
    +      return $core.tools.asyncCredentials(profile);
      };
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

## 4. Update src/cores

To update the src/cores directory in your project using the latest version from [lemon-templates-api](https://github.com/lemoncloud-io/lemon-templates-api), follow these steps:

1. In your project: Delete the existing src/cores folder.
2. From lemon-templates-api: Copy the entire src/cores directory.
3. In your project: Paste the copied src/cores directory into the same path (src/cores).

---

## At-a-Glance Checklist

* [ ] **Upgrade lemon-core**
* [ ] **Upgrade to Node.js 22**
  * Change `nvm` version, update `.nvmrc`
  * Change node.js runtime version of your profile, update `config.js`
  * Update plugins in serverless.yml
* [ ] **Install lemon-devkit** (devDependency)
* [ ] **Review AWS SDK v3 migration changes**

  * **Credentials**: Replace old `credentials` code with `asyncCredentials()`
  * **Client Initialization**: Use `awsConfig($engine, region)`
* [ ] **Update src/cores**
* [ ] **Review CI/CD environments**

  * Ensure Node.js 22 is set in `serverless.yml`, `Dockerfile`, etc.

---
