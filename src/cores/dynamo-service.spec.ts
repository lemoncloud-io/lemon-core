/**
 * `dynamo-service.spec.js`
 * - unit test for `dynamo-service` w/ dummy data
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
import { DynamoService, DummyDynamoService, DynamoOption } from './dynamo-service';

interface MyModel extends GeneralItem {
    id?: string;
}
export const instance = () => {
    const tableName = 'DynamoTest';
    const idName = 'id';
    const options: DynamoOption = { tableName, idName };
    const service: DynamoService<MyModel> = new DynamoService<MyModel>(options);
    const dummy: DummyDynamoService<MyModel> = new DummyDynamoService<MyModel>('dummy-dynamo-data.yml', options);
    return { service, dummy };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('DynamoService', () => {
    //! use `env.PROFILE`
    const PROFILE = credentials(environ('PROFILE'));

    //! dummy storage service.
    it('should pass basic CRUD w/ dummy', async done => {
        /* eslint-disable prettier/prettier */
        //! load dummy storage service.
        const { service, dummy } = instance();

        //! check dummy data.
        expect2(() => dummy.hello()).toEqual('dummy-dynamo-service:DynamoTest');
        expect2(await dummy.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - id:00');
        expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({ id: 'A0', type: 'account', name: 'lemon' });
        expect2(await dummy.readItem('A1'), 'id,type,name').toEqual({ id: 'A1', type: 'account', name: 'Hong' });

        //! basic simple CRUD test.
        expect2(await dummy.readItem('A0').catch(GETERR), 'id').toEqual({ id: 'A0' });
        expect2(await dummy.deleteItem('A0').catch(GETERR)).toEqual(null);
        expect2(await dummy.readItem('A0').catch(GETERR), 'id').toEqual('404 NOT FOUND - id:A0');
        expect2(await dummy.saveItem('A0', { type: '' }).catch(GETERR), 'id,type').toEqual({ id: 'A0', type: '' });
        expect2(await dummy.readItem('A0').catch(GETERR), 'id,type').toEqual({ id: 'A0', type: '' });
        expect2(await dummy.updateItem('A0', 0, { type: 'account' }).catch(GETERR), 'id').toEqual({ id: 'A0' });
        expect2(await dummy.readItem('A0').catch(GETERR), 'id,type').toEqual({ id: 'A0', type: 'account' });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! dummy storage service.
    it('should pass simple list w/ dummy', async done => {
        /* eslint-disable prettier/prettier */
        //! load dummy storage service.
        const { dummy } = instance();

        //! check dummy data.
        expect2(() => dummy.hello()).toEqual('dummy-dynamo-service:DynamoTest');

        expect2(await dummy.listItems(),'!list').toEqual({ page:1, limit:2, total:3 });
        expect2(await dummy.listItems(1,1)).toEqual({ page:1, limit:1, total:3, list:[{ id: 'A0', type: 'account', name: 'lemon' }] });
        expect2(await dummy.listItems(2,2)).toEqual({ page:2, limit:2, total:3, list:[{ id: 'A2', type: 'account', name: 'last' }] });

        /* eslint-enable prettier/prettier */
        done();
    });
});
