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

import { credentials, hasCredentials, loadDataYml } from '../tools/';
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
    return { service, dummy, tableName };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('DynamoService', () => {
    //! dummy storage service.
    describe('DummyDynamoService', () => {
        //! load dummy storage service.
        const { dummy, tableName } = instance();

        it('should pass basic CRUD', async done => {
            //! check dummy data.
            expect2(dummy.hello()).toEqual(`dummy-dynamo-service:${tableName}`);
            expect2(await dummy.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - id:00');
            expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({ id: 'A0', type: 'account', name: 'lemon' });
            expect2(await dummy.readItem('A1'), 'id,type,name').toEqual({ id: 'A1', type: 'account', name: 'Hong' });

            //! basic simple CRUD test.
            expect2(await dummy.readItem('A0').catch(GETERR), 'id').toEqual({ id: 'A0' });
            expect2(await dummy.deleteItem('A0').catch(GETERR)).toEqual(null);
            expect2(await dummy.readItem('A0').catch(GETERR), 'id').toEqual('404 NOT FOUND - id:A0');
            expect2(await dummy.saveItem('A0', { type: '' }).catch(GETERR), 'id,type').toEqual({ id: 'A0', type: null }); // empty string will be saved as null
            expect2(await dummy.readItem('A0').catch(GETERR), 'id,type').toEqual({ id: 'A0', type: null });
            expect2(await dummy.updateItem('A0', 0, { type: 'account' }).catch(GETERR), 'id').toEqual({ id: 'A0' });
            expect2(await dummy.readItem('A0').catch(GETERR), 'id,type').toEqual({ id: 'A0', type: 'account' });
            /* eslint-enable prettier/prettier */
            done();
        });

        it('should pass simple list w/ dummy', async done => {
            //! check dummy data.
            expect2(dummy.hello()).toEqual(`dummy-dynamo-service:${tableName}`);
            expect2(await dummy.listItems(), '!list').toEqual({ page: 1, limit: 2, total: 3 });
            expect2(await dummy.listItems(1, 1), '!list').toEqual({ page: 1, limit: 1, total: 3 });
            expect2(await dummy.listItems(2, 2), '!list').toEqual({ page: 2, limit: 2, total: 3 });
            /* eslint-enable prettier/prettier */
            done();
        });
    });

    //! real DynamoDB storage service.
    describe('DynamoService (real)', () => {
        // Following tests cannot be run without credentials
        credentials(environ('PROFILE'));
        if (!hasCredentials()) return;

        const { service, tableName } = instance();
        const dataMap = new Map<string, MyModel>();

        beforeAll(async done => {
            // Initialize data in the table
            const data: MyModel[] = loadDataYml('dummy-dynamo-data.yml').data;
            await data.map(async item => {
                const saved = await service.saveItem(item.id, item);
                dataMap.set(saved.id, saved); // Store into map
            });
            done();
        });

        it('should pass basic CRUD', async done => {
            //! check dummy data.
            expect2(service.hello()).toEqual(`dynamo-service:${tableName}`);
            expect2(await service.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - id:00');
            expect2(await service.readItem('A0').catch(GETERR)).toEqual({ id: 'A0', type: 'account', name: 'lemon' });
            expect2(await service.readItem('A1'), 'id,type,name').toEqual({ id: 'A1', type: 'account', name: 'Hong' });

            //! basic simple CRUD test.
            expect2(await service.readItem('A0').catch(GETERR), 'id').toEqual({ id: 'A0' });
            expect2(await service.deleteItem('A0').catch(GETERR)).toEqual(null);
            expect2(await service.readItem('A0').catch(GETERR), 'id').toEqual('404 NOT FOUND - id:A0');
            expect2(await service.saveItem('A0', { type: '' }).catch(GETERR), 'id,type').toEqual({ id: 'A0', type: null }); // empty string will be saved as null
            expect2(await service.readItem('A0').catch(GETERR), 'id,type').toEqual({ id: 'A0', type: null });
            expect2(await service.updateItem('A0', 0, { type: 'account' }).catch(GETERR), 'id').toEqual({ id: 'A0' });
            expect2(await service.readItem('A0').catch(GETERR), 'id,type').toEqual({ id: 'A0', type: 'account' });
            done();
        });

        afterAll(async done => {
            // Cleanup the table
            await Promise.all([...dataMap.keys()].map(id => service.deleteItem(id)));
            done();
        });
    });
});
