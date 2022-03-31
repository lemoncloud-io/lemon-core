/**
 * `helpers/simple-router.spec.ts`
 * - test runnder for `helpers/simple-router.ts`
 *
 *
 * @author      Albert <albert@lemoncloud.io>
 * @date        2022-03-31 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2022 - All Rights Reserved.
 */
import { SimpleRouter } from './simple-router';
import { GETERR, expect2 } from '../common/test-helper';

const wait = async (timeout: number) =>
    new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve(timeout);
        }, timeout);
    });

//! main test body.
describe(`class SimpleRouter`, () => {
    test('create SimpleRouter', (done: any) => {
        const router = new SimpleRouter();

        // check default option value
        expect2(router.allowMultipleRouter).toEqual(false);
        done();
    });

    test('get() / add()', (done: any) => {
        const router = new SimpleRouter();

        expect2(router.get('/empty')).toEqual([]);

        // add router
        const routingFunc = (num: number) => `${num}:ok`;
        router.add('/one', routingFunc);

        const addedFuncsInRouter = router.get('/one');
        expect2(addedFuncsInRouter).toEqual([routingFunc]);
        expect2(addedFuncsInRouter[0](2022)).toEqual('2022:ok');

        // can not add another function in same path
        expect(() => router.add('/one', () => 'another function')).toThrow('Already set router function in path(/one)');

        // can have multiple routing function in one routing-path
        const multipleRouter = new SimpleRouter({ allowMultipleRouter: true });
        multipleRouter.add('/one', routingFunc);
        multipleRouter.add('/one', () => 'another function');

        expect2(() => multipleRouter.get('/one')).toHaveLength(2);

        done();
    });

    test('remove()', (done: any) => {
        const router = new SimpleRouter({ allowMultipleRouter: true });

        const func = () => 'ok';
        // remove not added function
        expect2(router.remove('/one', func)).toEqual(0);
        expect2(() => router.get('/one')).toHaveLength(0);

        router.add('/one', func);
        router.add('/two', func);
        router.add('/two', func);

        expect2(() => router.get('/one')).toHaveLength(1);
        expect2(() => router.get('/two')).toHaveLength(2);

        // remove func in '/one' path
        expect2(router.remove('/one', func)).toEqual(1);
        expect2(() => router.get('/one')).toHaveLength(0);

        // remove not added function
        const otherFunc = () => 'another';
        expect2(router.remove('/two', otherFunc)).toEqual(0);
        expect2(() => router.get('/two')).toHaveLength(2);

        // add otherFunc
        router.add('/two', otherFunc);
        expect2(() => router.get('/two')).toHaveLength(3); // [func, func, otherFunc]

        // remove func in '/two' path
        expect2(router.remove('/two', func)).toEqual(2);
        expect2(() => router.get('/two')).toHaveLength(1); // [otherFunc]

        done();
    });

    test('route()', async (done: any) => {
        // route() is function that run added function in router-path
        const router = new SimpleRouter({ allowMultipleRouter: true });

        // add router
        const routingFunc = (num: number) => `${num}:ok`;
        router.add('/one', routingFunc);
        expect2(await router.route('/one', 2020)).toEqual(['2020:ok']);

        // add async, throw error functions
        const asyncFunc = async (num: number) => {
            await wait(200);
            return `${num}-async:ok`;
        };
        let err: Error;
        const errorFunc = async (num: number) => {
            err = new Error(`${num}:err`);
            throw err;
        };
        router.add('/one', asyncFunc);
        router.add('/one', errorFunc);
        expect2(await router.route('/one', 2020)).toEqual(['2020:ok', '2020-async:ok', err]);
        expect2(err.message).toEqual('2020:err');

        done();
    });
});
