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
import { loadProfile } from '../environ';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { GETERR, expect2, _it, environ } from '../common/test-helper';

import { loadDataYml } from '../tools/';
import { GeneralItem } from './core-types';
import { DynamoService, DummyDynamoService, DynamoOption } from './dynamo-service';

interface MyModel extends GeneralItem {
    ID?: string;
}
export const instance = () => {
    const tableName = 'DynamoTest';
    const idName = 'ID';
    const options: DynamoOption = { tableName, idName };
    const service: DynamoService<MyModel> = new DynamoService<MyModel>(options);
    const dummy: DummyDynamoService<MyModel> = new DummyDynamoService<MyModel>('dummy-dynamo-data.yml', options);
    return { service, dummy, tableName };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('DynamoService', () => {
    const PROFILE = loadProfile(); // use `env/<ENV>.yml`
    //! test prepareUpdateItem
    describe('UpdateExpression', () => {
        const { dummy } = instance();
        const id = '00';
        const sort: string | number = null;
        let payload: any;

        //! nomalizer.
        it('should pass normalize()', () => {
            const normalize = DynamoService.normalize;
            expect2(() => normalize('')).toEqual(null);
            expect2(() => normalize('a')).toEqual('a');

            expect2(() => normalize({ a: '' })).toEqual({ a: null });
            expect2(() => normalize({ a: 'a' })).toEqual({ a: 'a' });
        });

        it('update', () => {
            /* eslint-disable prettier/prettier */

            payload = dummy.prepareUpdateItem(id, sort, {});
            expect2(() => payload.UpdateExpression).toBe('');
            expect2(() => payload.ExpressionAttributeNames).toEqual({});
            expect2(() => payload.ExpressionAttributeValues).toEqual({});

            payload = dummy.prepareUpdateItem(id, sort, { myField: '' });  //! check '' empty string value.
            expect2(() => payload.UpdateExpression).toBe('SET #myField = :myField');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField': 'myField' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField': null });

            payload = dummy.prepareUpdateItem(id, sort, { myField: 'str' });
            expect2(() => payload.UpdateExpression).toBe('SET #myField = :myField');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField': 'myField' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField': 'str' });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: 'str', fieldB: null });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA = :fieldA, #fieldB = :fieldB');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA', '#fieldB': 'fieldB' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA': 'str', ':fieldB': null });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: 1, fieldB: ['l', 'i', 's', 't'] });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA = :fieldA, #fieldB = :fieldB');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA', '#fieldB': 'fieldB' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA': 1, ':fieldB': ['l', 'i', 's', 't'] });

            /* eslint-enable prettier/prettier */
        });

        it('increment number', () => {
            /* eslint-disable prettier/prettier */

            payload = dummy.prepareUpdateItem(id, sort, {}, { myField: 1 });
            expect2(() => payload.UpdateExpression).toBe('ADD #myField :myField');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField': 'myField' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField': 1 });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: 'str' }, { fieldB: -1 });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA = :fieldA ADD #fieldB :fieldB');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA', '#fieldB': 'fieldB' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA': 'str', ':fieldB': -1 });

            /* eslint-enable prettier/prettier */
        });

        it('list append/replace/remove', () => {
            /* eslint-disable prettier/prettier */

            payload = dummy.prepareUpdateItem(id, sort, {}, { myField: [3, 1] } as any);
            expect2(() => payload.UpdateExpression).toBe('SET #myField = list_append(if_not_exists(#myField, :myField_0), :myField)');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField': 'myField' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField': [3, 1], ':myField_0': [] });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: { setIndex: [[1, 'a'], [3, 3]] } });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA[1] = :fieldA_0_, #fieldA[3] = :fieldA_1_');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA_0_': 'a', ':fieldA_1_': 3 });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: { removeIndex: [2, 3] } });
            expect2(() => payload.UpdateExpression).toBe('REMOVE #fieldA[2], #fieldA[3]');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({});

            // all together
            payload = dummy.prepareUpdateItem(id, sort, { fieldA: [1, null], fieldC: { removeIndex: [1] }, fieldD: { setIndex: [[3, 3]] } }, { fieldB: [2, 4] });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA = :fieldA, #fieldD[3] = :fieldD_0_, #fieldB = list_append(if_not_exists(#fieldB, :fieldB_0), :fieldB) REMOVE #fieldC[1]');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA', '#fieldB': 'fieldB', '#fieldC': 'fieldC', '#fieldD': 'fieldD' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA': [1, null], ':fieldB': [2, 4], ':fieldB_0': [], ':fieldD_0_': 3 });

            /* eslint-enable prettier/prettier */
        });
    });

    //! dummy storage service.
    describe('DummyDynamoService', () => {
        //! load dummy storage service.
        const { dummy, tableName } = instance();

        it('should pass basic CRUD', async done => {
            //! check dummy data.
            expect2(dummy.hello()).toEqual(`dummy-dynamo-service:${tableName}`);
            /* eslint-disable prettier/prettier */
            expect2(await dummy.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - ID:00');
            expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({ ID: 'A0', type: 'account', name: 'lemon' });
            expect2(await dummy.readItem('A1'), 'ID,type,name').toEqual({ ID: 'A1', type: 'account', name: 'Hong' });

            //! basic simple CRUD test.
            expect2(await dummy.readItem('A0').catch(GETERR), 'ID').toEqual({ ID: 'A0' });
            expect2(await dummy.deleteItem('A0').catch(GETERR)).toEqual(null);
            expect2(await dummy.readItem('A0').catch(GETERR), 'ID').toEqual('404 NOT FOUND - ID:A0');
            expect2(await dummy.saveItem('A0', { type: '' }).catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: null }); // empty string will be saved as null
            expect2(await dummy.readItem('A0').catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: null });
            expect2(await dummy.updateItem('A0', 0, { type: 'account' }).catch(GETERR), 'ID').toEqual({ ID: 'A0' });
            expect2(await dummy.readItem('A0').catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: 'account' });
            /* eslint-enable prettier/prettier */
            done();
        });

        it('should pass simple list w/ dummy', async done => {
            //! check dummy data.
            expect2(dummy.hello()).toEqual(`dummy-dynamo-service:${tableName}`);
            /* eslint-disable prettier/prettier */
            expect2(await dummy.listItems(), '!list').toEqual({ page: 1, limit: 2, total: 3 });
            expect2(await dummy.listItems(1, 1), '!list').toEqual({ page: 1, limit: 1, total: 3 });
            expect2(await dummy.listItems(2, 2), '!list').toEqual({ page: 2, limit: 2, total: 3 });
            /* eslint-enable prettier/prettier */
            done();
        });
    });

    //! real DynamoDB storage service.
    describe('DynamoService (real)', () => {
        if (!PROFILE) return;

        const { service, tableName } = instance();
        const dataMap = new Map<string, MyModel>();

        beforeAll(async done => {
            // Initialize data in the table
            const data: MyModel[] = loadDataYml('dummy-dynamo-data.yml').data;
            await data.map(async item => {
                const saved = await service.saveItem(item.ID, item);
                dataMap.set(saved.ID, saved); // Store into map
            });
            done();
        });

        it('should pass basic CRUD', async done => {
            //! check dummy data.
            expect2(service.hello()).toEqual(`dynamo-service:${tableName}`);
            /* eslint-disable prettier/prettier */
            expect2(await service.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - ID:00');
            expect2(await service.readItem('A0').catch(GETERR)).toEqual({ ID: 'A0', type: 'account', name: 'lemon' });
            expect2(await service.readItem('A1').catch(GETERR), 'ID,type,name').toEqual({ ID: 'A1', type: 'account', name: 'Hong' });

            //! basic simple CRUD test.
            expect2(await service.readItem('A0').catch(GETERR), 'ID').toEqual({ ID: 'A0' });
            expect2(await service.deleteItem('A0').catch(GETERR)).toEqual(null);
            expect2(await service.readItem('A0').catch(GETERR), 'ID').toEqual('404 NOT FOUND - ID:A0');
            expect2(await service.saveItem('A0', { type: '' }).catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: null }); // empty string will be saved as null
            expect2(await service.readItem('A0').catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: null });
            expect2(await service.updateItem('A0', 0, { type: 'account' }).catch(GETERR), 'ID').toEqual({ ID: 'A0' });
            expect2(await service.readItem('A0').catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: 'account' });
            /* eslint-enable prettier/prettier */
            done();
        });

        afterAll(async done => {
            // Cleanup the table
            await Promise.all([...dataMap.keys()].map(id => service.deleteItem(id)));
            done();
        });
    });
});
