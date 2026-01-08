# UPGRADE GUIDE: lemon-core V3 to V4

---

## 0. Update lemon-core Version

```sh
npm install lemon-core@^4.1.7 --save
```

---

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
-            runtime: 'nodejs18.x',
+            runtime: 'nodejs22.x',
        },
```

* Update plugins in serverless.yml

```diff
  plugins:
-   - serverless-offline
+   # - serverless-offline  # WARN: fails in Node.js 22.x
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
> **Workaround**: Execute the deployment command in **Node.js 18** (`nvm use 18`), while keeping the Lambda runtime as `nodejs22.x`.

---

## 2. Install `lemon-devkit`

```bash
npm install --save-dev lemon-devkit
```

### package.json Summary

```diff
 {
   "engines": {
-    "node": ">=14",
+    "node": ">=22"
   },
   "dependencies": {
-    "lemon-core": "^3.x",
+    "lemon-core": "^4.x",
   },
   "devDependencies": {
+    "lemon-devkit": "^0.0.3",
   }
 }
```

---

## 3. AWS SDK: v2 to v3 Migration

### 3.1 Credential Management

Replace legacy `credentials` with `asyncCredentials()`:

```ts
import { asyncCredentials } from 'lemon-core';
const credentials = await asyncCredentials(PROFILE);
```

   * **\[express.ts Updates]**

  ```diff
    export const credentials = async (name?: string) => {
        const profile = $engine.environ('PROFILE', NAME) as string;
  -     return $core.tools.credentials(profile);
  +     return $core.tools.asyncCredentials(profile);
    };
  ```

### 3.2 Client Initialization

Use `awsConfig($engine, region)` for v3 clients:

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import $engine, { awsConfig } from 'lemon-core';

const client = new SQSClient(awsConfig($engine, 'ap-northeast-2'));
```

---

## 4. Update src/cores

To update the src/cores directory in your project using the latest version from [lemon-templates-api](https://github.com/lemoncloud-io/lemon-templates-api), follow these steps:

1. In your project: Delete the existing src/cores folder.
2. From lemon-templates-api: Copy the entire src/cores directory.
3. In your project: Paste the copied src/cores directory into the same path (src/cores).

## 5. DynamoDB IAM Permissions (v4.1.x)

Starting from `lemon-core@4.1.x`, batch operations require additional IAM permissions.

### Required Permissions

```yaml
iamRoleStatements:
  - Effect: Allow
    Action:
      # Existing permissions
      - dynamodb:GetItem
      - dynamodb:PutItem
      - dynamodb:UpdateItem
      - dynamodb:DeleteItem
      - dynamodb:Query
      - dynamodb:Scan
      # NEW: v4.1.x batch operations
      - dynamodb:BatchGetItem
      - dynamodb:BatchWriteItem
    Resource:
      - "arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${self:custom.tables.main}"
      - "arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${self:custom.tables.main}/index/*"
```

### New Batch Methods

| Method | Description | Required Permission |
|--------|-------------|---------------------|
| `mreadItem` | Batch read (max 100 items/request) | `BatchGetItem` |
| `msaveItem` | Batch save (max 25 items/request) | `BatchWriteItem` |
| `mupdateItem` | Batch update (max 25 items/request) | `BatchWriteItem` |
| `saveAllUpdates({ useBatch: true })` | AbstractProxy batch mode | `BatchWriteItem` |

---

## At-a-Glance Checklist

* [ ] **Upgrade lemon-core** to `^4.1.7`
* [ ] **Upgrade to Node.js 22**
  * Update `.nvmrc`
  * Update `config.js` runtime
  * Comment out `serverless-offline` plugin
* [ ] **Install lemon-devkit** (devDependency)
* [ ] **Migrate AWS SDK v2 → v3**
  * `credentials()` → `asyncCredentials()`
  * Use `awsConfig($engine, region)`
* [ ] **Update src/cores** from lemon-templates-api
* [ ] **Add DynamoDB IAM Permissions** (v4.1.x)
  * `dynamodb:BatchGetItem`
  * `dynamodb:BatchWriteItem`
* [ ] **Review CI/CD environments**
  * Ensure Node.js 22 in `serverless.yml`, `Dockerfile`, etc.

---
