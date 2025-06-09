# UPGRADE GUIDE: lemon-core V3 to V4

---

### 0. Update lemon-core Version

```sh
$ npm install lemon-core --save
```

### 1. Upgrade Node.js Version

```sh
$ nvm install 22
$ nvm use 22
```

* Update `.nvmrc` file to `22`

---

### 2. AWS SDK: v2 to v3 Migration

1. **Credential Management**

   * Replace legacy `credentials` approach with `asyncCredentials()` from `lemon-core`.
   * Example:

     ```ts
     import { asyncCredentials } from 'lemon-core';
     const credentials = await asyncCredentials(PROFILE);
     ```

2. **Client Initialization**

   * Use `awsConfig($engine, region)` for initializing v3 clients.
   * Example:

     ```ts
     import { SQSClient } from '@aws-sdk/client-sqs';
     import $engine from 'lemon-core';

     async function createSqsClient() {
       const region = 'ap-northeast-2';
       return new SQSClient(awsConfig($engine, region));
     }
     ```

---

### 3. Install `lemon-devkit`

* Add as a `devDependency`:

  ```sh
  $ npm install --save-dev lemon-devkit
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

### At-a-Glance Checklist

* [ ] **Upgrade lemon-core**
* [ ] **Upgrade to Node.js 22**

  * Change `nvm` version, update `.nvmrc`
* [ ] **Review AWS SDK v3 migration changes**

  * **Credentials**: Replace old `credentials` code with `asyncCredentials()`
  * **Client Initialization**: Use `awsConfig($engine, region)`
* [ ] **Install lemon-devkit** (devDependency)
* [ ] **Review CI/CD environments**

  * Ensure Node.js 22 is set in `serverless.yml`, `Dockerfile`, etc.

---
