/**
 * `index.ts`
 * - main index
 *
 * **NOTE**
 * - override `process.env` before use(or import) this.
 *
 * @author Steve <steve@lemoncloud.io>
 * @date   2019-08-09 initial commit
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
//NOTE! - if loading this index.ts, it will trigger initializing `lemon-engine`
export * from './common/types';
export * from './core/engine';
export * from './tools/';
// console.log('! core: init index');

//! loading additional builders.
import $WEB from './builder/WEB';
import $SNS from './builder/SNS';
import $SQS from './builder/SQS';

//! export functions.
export { $WEB, $SNS, $SQS }

