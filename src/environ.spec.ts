/**
 * `environ.spec.ts`
 * - test runnder for `tools/environ.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2025-05-20 initial unit test for environ.
 *
 * @copyright (C) lemoncloud.io 2025 - All Rights Reserved.
 */
import loadEnviron, { credentials, loadProfile } from './environ';
import { expect2 } from './common/test-helper';

//! main test body.
describe('environ', () => {
    const ENV = process?.env?.ENV ?? '';
    const PROFILE = loadProfile();
    PROFILE && console.info(`! PROFILE @environ =`, PROFILE);

    it(`should pass loadProfile(${ENV})`, async () => {
        if (!ENV) {
            //* for `npm run test`
            expect2(() => PROFILE).toEqual('');
        } else {
            //* for `npm run test.lemon`
            expect2(() => PROFILE).toEqual(ENV);
        }
    });

    it(`should pass credentials(${ENV})`, async () => {
        expect2(() => credentials(null)).toEqual();
        expect2(() => credentials('')).toEqual();
        expect2(() => credentials('lemon')).toEqual(
            'WARN! credentials() is deprecated. use `asyncCredentials()` from lemon-devkit instead!',
        );
    });

    it(`should pass loadEnviron(${ENV})`, async () => {
        //* check `env/<ENV>.yml`
        const _load = (ENV?: string) => loadEnviron(null, { ENV });
        expect2(() => _load(null), 'NAME').toEqual({ NAME: '' });
        expect2(() => _load(''), 'NAME').toEqual({ NAME: '' });
        expect2(() => _load('none'), 'NAME').toEqual({ NAME: '' });
        expect2(() => _load('lemon'), 'NAME').toEqual({ NAME: 'test-lemon' });
        expect2(() => _load('test'), 'NAME').toEqual('FILE NOT FOUND:./env/test.yml');
    });

    //* test error scenarios with isolated modules
    describe('error scenarios', () => {
        afterEach(() => {
            jest.resetModules();
            jest.restoreAllMocks();
        });

        it('should return null when module cannot be found (line 35)', async () => {
            //* clear all module caches first
            jest.resetModules();
            jest.resetAllMocks();

            //* use jest.doMock to throw module not found error BEFORE requiring environ
            jest.doMock('lemon-devkit', () => {
                const err = new Error("Cannot find module 'lemon-devkit'") as any;
                err.code = 'MODULE_NOT_FOUND';
                throw err;
            });

            //* when loadEnviron is called, _load will catch the error and return null
            //* since $tools is null, it should throw the missing function error
            expect2(() => loadEnviron(null, { ENV: 'test' })).toEqual(
                'loadEnviron(function) is required (npm i -D lemon-devkit) - loadEnviron()',
            );
        });

        it('should throw error when lemon-devkit is missing loadEnviron function', async () => {
            jest.isolateModules(() => {
                //* mock lemon-devkit without loadEnviron function
                jest.doMock('lemon-devkit', () => ({
                    loadProfile: jest.fn(),
                }));

                expect2(() => loadEnviron(null, { ENV: 'test' })).toEqual(
                    'loadEnviron(function) is required (npm i -D lemon-devkit) - loadEnviron()',
                );
            });
        });

        it('should throw error when lemon-devkit is missing loadProfile function', async () => {
            jest.isolateModules(() => {
                //* mock lemon-devkit without loadProfile function
                jest.doMock('lemon-devkit', () => ({
                    loadEnviron: jest.fn(),
                }));

                expect2(() => loadProfile(process)).toEqual(
                    'loadProfile(function) is required (npm i -D lemon-devkit) - loadProfile()',
                );
            });
        });

        it('should return empty string when loadProfile throws credentials error with [default]', async () => {
            jest.isolateModules(() => {
                //* mock lemon-devkit with loadProfile that throws credentials error
                jest.doMock('lemon-devkit', () => ({
                    loadEnviron: jest.fn(),
                    loadProfile: jest.fn(() => {
                        throw new Error('Could not resolve credentials from [default] profile');
                    }),
                }));

                expect2(() => loadProfile(process)).toEqual('');
            });
        });

        it('should throw error when loadProfile throws non-credentials error', async () => {
            jest.isolateModules(() => {
                //* mock lemon-devkit with loadProfile that throws other error
                jest.doMock('lemon-devkit', () => ({
                    loadEnviron: jest.fn(),
                    loadProfile: jest.fn(() => {
                        throw new Error('Some other error occurred');
                    }),
                }));

                expect2(() => loadProfile(process)).toEqual('Some other error occurred');
            });
        });

        it('should throw error when module loading fails with non-module-not-found error', async () => {
            jest.isolateModules(() => {
                //* mock lemon-devkit to throw a syntax error when required
                //* this tests the _load function's error handling for non-module-not-found errors
                jest.doMock('lemon-devkit', () => {
                    throw new Error('SyntaxError: Unexpected token in module');
                });

                //* when loadEnviron is called, it will try to _load('lemon-devkit')
                //* which will catch the error and re-throw it (since it's not "cannot find module")
                expect2(() => loadEnviron(null, { ENV: 'test' })).toEqual('SyntaxError: Unexpected token in module');
            });
        });

        it('should throw error when module loading fails with syntax error for loadProfile', async () => {
            jest.isolateModules(() => {
                //* mock lemon-devkit to throw a syntax error when required
                jest.doMock('lemon-devkit', () => {
                    throw new Error('Module parse failed: Unexpected identifier');
                });

                //* when loadProfile is called, it will try to _load('lemon-devkit')
                //* which will catch the error and re-throw it
                expect2(() => loadProfile(process)).toEqual('Module parse failed: Unexpected identifier');
            });
        });
    });
});
