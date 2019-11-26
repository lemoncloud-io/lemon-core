/**
 * `engine/index.tx`
 * - engine bootloader
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2018-05-23 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
//! create engine in global scope (WARN! should run top level)
import engine from './builder';
import { LemonEngine } from './types';
export const $engine: LemonEngine = engine(global, { env: process.env });

//! re-use core modules.
export const $U = $engine.U;
export const $_ = $engine._;
if (!$U) throw new Error('$U(utilities) is required!');
if (!$_) throw new Error('$_(lodash) is required!');

//! export common(log) functions
export const _log = $engine.log;
export const _inf = $engine.inf;
export const _err = $engine.err;

//! export sub-modules
export * from './types';
export * from './engine';
