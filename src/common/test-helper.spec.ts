/**
 * `test-helper.spec.ts`
 * - unit test for `ticket-helper`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-10-16 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, marshal, Filter, _it, environ, waited, GETERR, GETERR$, NUL404 } from './test-helper';

//! main test body.
describe('TestHelper', () => {
    //! test expect2()
    it('should pass expect2 helper', async done => {
        /* eslint-disable prettier/prettier */
        expect2(()=>{ throw new Error('HI Error') }).toEqual('HI Error');
        expect2(async ()=>{ throw new Error('HI Error') }).toEqual('HI Error');
        expect2(()=>({ i:1, n:'hi'}), 'n').toEqual({n:'hi'});
        expect2(()=>({ i:1, n:'hi'}), '!i').toEqual({n:'hi'});
        expect2(()=>([{ i:1, n:'hi', j:2}]), 'i,n').toEqual([{i:1, n:'hi'}]);
        expect2(()=>('hello me!'), 'n').toEqual('hello me!');
        expect2(()=>(['A','B']), 'n').toEqual(['A','B']);
        expect2(null, 'a').toBe(null);
        expect2(undefined, 'a').toBe(undefined);
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test expect2()
    it('should pass expect2 helper', async done => {
        done();
    });

    //! test _it()
    _it('should ignore this test', async done => {
        done();
    });

    //! test environ()
    it('should pass environ helper', async done => {
        expect2(environ('LS')).toEqual(process.env['LS']);
        expect2(environ('ABC')).toEqual('');
        expect2(environ('ABC', 'abc')).toEqual('abc');
        done();
    });

    //! test _it()
    it('should helper functions', async done => {
        const read = async (id: '' | '0' | '1'): Promise<any> => {
            if (!id) throw new Error('@a (string) is required!');
            if (id == '0') throw new Error(`404 NOT FOUND - id:${id}`);
            return { id };
        };

        expect2(await read('').catch(GETERR)).toEqual('@a (string) is required!');
        expect2(await read('0').catch(GETERR)).toEqual('404 NOT FOUND - id:0');
        expect2(await read('1').catch(GETERR)).toEqual({ id: '1' });

        expect2(await read('').catch(GETERR$)).toEqual({ error: '@a (string) is required!' });
        expect2(await read('0').catch(GETERR$)).toEqual({ error: '404 NOT FOUND - id:0' });
        expect2(await read('1').catch(GETERR$)).toEqual({ id: '1' });

        expect2(() => read('').catch(NUL404)).toEqual('@a (string) is required!');
        expect2(() => read('0').catch(NUL404)).toEqual(null);
        expect2(() => read('1').catch(NUL404)).toEqual({ id: '1' });

        done();
    });

    //! test marshal()
    it('should pass marshal()', async done => {
        const defFilter: Filter<string> = (name: string, val: any) => `${name}=${val}`;
        /* eslint-disable prettier/prettier */
        expect2(marshal({ a:1 }, defFilter)).toEqual([ 'a=1' ]);
        expect2(marshal({ a:true }, defFilter)).toEqual([ 'a=true' ]);
        expect2(marshal({ a:{b:false} }, defFilter)).toEqual([ 'a.b=false' ]);
        expect2(marshal({ a:[1,'b'] }, defFilter)).toEqual([ 'a.0=1', 'a.1=b' ]);
        expect2(marshal({ a:[1,'b'] }, defFilter)).toEqual([ 'a.0=1', 'a.1=b' ]);
        expect2(marshal({ a:[1,{b:1}] }, defFilter)).toEqual([ 'a.0=1', 'a.1.b=1' ]);
        expect2(() => marshal({ a:[1,{b:1}] }, null)).toEqual('filter is required!');
        expect2(marshal(['a', 2], defFilter)).toEqual([ '0=a','1=2' ]);

        //! test simple filter
        if (1){
            const filter: Filter<string> = (name, val) => name.startsWith('a.1') ? `${name}=${val}` : null;
            expect2(marshal({ a:[1,{b:1}] }, filter)).toEqual([ 'a.1.b=1' ]);
        }

        //! test filter-replace
        if (1){
            const origin = { a:[1,{b:1}] };                         // origin
            const target = JSON.parse(JSON.stringify(origin));      // deep copy
            const filter: Filter<string> = (name, val, thiz, key) => {
                if (name == 'a.0') thiz[key] = 3;                   // replace origin.
                if (name == 'a.1.b') thiz[key] = 5;                 // replace origin.
                return `${name}=${val}`;
            };
            expect2(target).toEqual(origin);
            expect2(marshal(target, filter)).toEqual([ 'a.0=1', 'a.1.b=1' ]);
            expect2(target).toEqual({ a:[3,{b:5}] });
            expect2(marshal(target, defFilter)).toEqual([ 'a.0=3', 'a.1.b=5' ]);
        }
        /* eslint-enable prettier/prettier */

        done();
    });

    //! test waited()
    it('should pass waited() by 200msec', async done => {
        const t1 = new Date().getTime();
        expect2(await waited()).toEqual(undefined);
        const t2 = new Date().getTime();
        expect2(t2 - t1 >= 200).toEqual(true);
        done();
    });

    //! test fially()
    it('should pass fianlly()', async done => {
        const $next = { next: 1 };
        const func = async (name: string, fx?: any, fin?: any) => {
            const node: any = { name };
            return Promise.resolve(node)
                .then(_ => ({ ..._, i: 1 }))
                .then(_ => (fx ? fx(_) : _))
                .then(_ => ({ ..._, i: 2 }))
                .catch(e => ({ ...node, error: GETERR(e) }))
                .finally(() => {
                    node.name = 'final';
                    node.next = $next.next++;
                    return fin ? fin(node) : node;
                });
        };

        const errs = (_: any) => {
            throw new Error(`err@mid - ${(_ && _.name) || ''}`);
        };
        const fins = (_: any) => {
            throw new Error(`err@fin - ${(_ && _.name) || ''}`);
        };
        const echo = (_: any) => {
            return _;
        };

        /* eslint-disable prettier/prettier */
        expect2($next).toEqual({ next: 1 });
        expect2(await func('hello').catch(GETERR)).toEqual({ name: 'hello', i: 2 });
        expect2($next).toEqual({ next: 2 });
        expect2(await func('hello', errs).catch(GETERR)).toEqual({ name: 'hello', i: undefined, error: 'err@mid - hello' });
        expect2($next).toEqual({ next: 3 });
        expect2(await func('hello', errs, fins).catch(GETERR)).toEqual('err@fin - final');                                          //! throw from finally
        expect2($next).toEqual({ next: 4 });
        expect2(await func('hello', null, fins).catch(GETERR)).toEqual('err@fin - final');
        expect2($next).toEqual({ next: 5 });
        expect2(await func('hello', errs, echo).catch(GETERR)).toEqual({ name: 'hello', i: undefined, error: 'err@mid - hello' });
        expect2($next).toEqual({ next: 6 });
        expect2(await func('hello', null, echo).catch(GETERR)).toEqual({ name: 'hello', i: 2 });
        expect2($next).toEqual({ next: 7 });
        /* eslint-enable prettier/prettier */

        done();
    });
});
