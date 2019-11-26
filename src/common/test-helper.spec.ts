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
import { expect2, marshal, Filter, _it } from './test-helper';

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
    _it('should pass expect2 helper', async done => {
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
});
