/**
 * `typings.d.ts`
 * - support json import in ts
 *
 *
 * @author Steve <steve@lemoncloud.io>
 * @date   2019-08-09 initial commit
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
declare module '*.json' {
    const value: any;
    export default value;
}
