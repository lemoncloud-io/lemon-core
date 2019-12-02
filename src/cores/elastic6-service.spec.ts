/**
 * `elastic6-service.spec.js`
 * - unit test for `elastic6-service` w/ dummy data
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-25 initial version with dummy serivce
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { GETERR, expect2, _it, environ } from '../common/test-helper';

import { credentials } from '../tools/';
import { GeneralItem } from './core-types';
import { Elastic6Service, DummyElastic6Service, Elastic6Option } from './elastic6-service';

interface MyModel extends GeneralItem {
    id?: string;
}
export const instance = () => {
    const endpoint = 'https://localhost:8443'; //NOTE - use tunneling to elastic6 endpoint.
    const indexName = 'test-v3';
    const idName = 'id';
    const options: Elastic6Option = { endpoint, indexName, idName };
    const service: Elastic6Service<MyModel> = new Elastic6Service<MyModel>(options);
    const dummy: Elastic6Service<MyModel> = new DummyElastic6Service<MyModel>('dummy-elastic6-data.yml', options);
    return { service, dummy };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('Elastic6Service', () => {
    //! use `env.PROFILE`
    const PROFILE = credentials(environ('PROFILE'));

    //! dummy storage service.
    it('should pass basic CRUD w/ dummy', async done => {
        /* eslint-disable prettier/prettier */
        //! load dummy storage service.
        const { service, dummy } = instance();

        //! check dummy data.
        expect2(await dummy.hello()).toEqual('dummy-elastic6-service:test-v3');
        expect2(await dummy.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - id:00');
        expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({ id: 'A0', type: 'account', name: 'lemon' });
        expect2(await dummy.readItem('A1'), 'id,type,name').toEqual({ id: 'A1', type: 'account', name: 'Hong' });

        // //! basic simple CRUD test.
        expect2(await dummy.readItem('A0').catch(GETERR), 'id').toEqual({ id: 'A0' });
        expect2(await dummy.deleteItem('A0').catch(GETERR), 'id').toEqual({ id: 'A0' });
        expect2(await dummy.readItem('A0').catch(GETERR), 'id').toEqual('404 NOT FOUND - id:A0');
        expect2(await dummy.saveItem('A0', { type: '' }).catch(GETERR), 'id,type').toEqual({ id: 'A0', type: '' });
        expect2(await dummy.readItem('A0').catch(GETERR), 'id,type').toEqual({ id: 'A0', type: '' });
        expect2(await dummy.updateItem('A0', { type: 'account' }).catch(GETERR), 'id').toEqual({ id: 'A0' });
        expect2(await dummy.readItem('A0').catch(GETERR), 'id,type').toEqual({ id: 'A0', type: 'account' });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! dummy storage service.
    it('should pass basic CRUD w/ real server', async done => {
        /* eslint-disable prettier/prettier */
        //! load dummy storage service.
        const { service, dummy } = instance();

        //! check dummy data.
        expect2(await service.hello()).toEqual('elastic6-service:test-v3');
        // expect2(await service.describe().catch(GETERR), '!settings,!mappings').toEqual({}); // must be passed.
        const hasError = '' + (await service.describe().catch(GETERR));
        if (hasError.endsWith('unknown error')) return done(); // ignore!

        //! make sure deleted.
        await service.deleteItem('A0').catch(GETERR);
        await service.deleteItem('A1').catch(GETERR);
        expect2(await service.readItem('A0').catch(GETERR)).toEqual('404 NOT FOUND - id:A0');
        expect2(await service.readItem('A1').catch(GETERR)).toEqual('404 NOT FOUND - id:A1');

        //! save to A0
        expect2(await service.saveItem('A0', { type:'', name:'a0' }).catch(GETERR), '!_version').toEqual({ _id:'A0', type:'', name:'a0' });
        expect2(await service.readItem('A0').catch(GETERR), '!_version').toEqual({ _id:'A0', id:'A0', type:'', name:'a0' }); // `._version` is incremented.
        // expect2(await service.pushItem({ name:'push-01' }).catch(GETERR), '').toEqual({ _id:'EHYvom4Bk-QqXBefOceC', _version:1, name:'push-01' }); // `._id` is auto-gen.
        expect2(await service.pushItem({ name:'push-01' }).catch(GETERR), '!_id').toEqual({ _version:1, name:'push-01' }); // `._id` is auto-gen.

        const data0 = await service.readItem('A0');
        expect2(await service.updateItem('A0', { name:'b0' }).catch(GETERR), '!_version').toEqual({ _id:'A0', name:'b0' });
        expect2(await service.updateItem('A0', { nick:'bb' }).catch(GETERR), '!_version').toEqual({ _id:'A0', nick:'bb' });
        expect2(await service.readItem('A0').catch(GETERR), '').toEqual({ _id:'A0', _version: Number(data0._version)+2, id:'A0', type:'', name:'b0', nick:'bb' }); // `._version` is incremented.

        expect2(await service.updateItem('A0', null, { count:2 }).catch(GETERR), '!_version').toEqual('404 INVALID FIELD - id:A0'); // no `.count` property.
        expect2(await service.updateItem('A0', { count:10 }).catch(GETERR), '!_version').toEqual({ _id:'A0', count:10 });
        expect2(await service.updateItem('A0', null, { count:2 }).catch(GETERR), '!_version').toEqual({ _id:'A0' });
        expect2(await service.deleteItem('A0').catch(GETERR), '!_version').toEqual({ _id:'A0' });
        expect2(await service.deleteItem('A0').catch(GETERR), '!_version').toEqual('404 NOT FOUND - id:A0');

        //! try to update A1 (which does not exist)
        expect2(await service.updateItem('A1', { name:'b0' }).catch(GETERR), '!_version').toEqual('404 NOT FOUND - id:A1');

        /* eslint-enable prettier/prettier */
        done();
    });
});
