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
import { describe, expect, it, vi } from 'vitest';
import { loadProfile } from '../../environ';
import { GETERR, expect2, _it } from '../../common/test-helper';
import { loadDataYml } from '../../tools/';
import { GeneralItem } from 'lemon-model';
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

//! main test body.
describe('DynamoService', () => {
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    //* test prepareUpdateItem
    describe('UpdateExpression', () => {
        const { dummy } = instance();
        const id = '00';
        const sort: string | number = null;
        let payload: any;

        //* nomalizer.
        it('should pass normalize()', () => {
            const normalize = DynamoService.normalize;
            expect2(() => normalize('')).toEqual(null);
            expect2(() => normalize('a')).toEqual('a');

            expect2(() => normalize({ a: '' })).toEqual({ a: null });
            expect2(() => normalize({ a: 'a' })).toEqual({ a: 'a' });
        });

        it('update', () => {
            payload = dummy.prepareUpdateItem(id, sort, {});
            expect2(() => payload.UpdateExpression).toBe('');
            expect2(() => payload.ExpressionAttributeNames).toEqual({});
            expect2(() => payload.ExpressionAttributeValues).toEqual({});

            payload = dummy.prepareUpdateItem(id, sort, { myField: '' }); //* check '' empty string value.
            expect2(() => payload.UpdateExpression).toBe('SET #myField = :myField');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField': 'myField' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField': null });

            payload = dummy.prepareUpdateItem(id, sort, { myField: 'str' });
            expect2(() => payload.UpdateExpression).toBe('SET #myField = :myField');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField': 'myField' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField': 'str' });

            payload = dummy.prepareUpdateItem(id, sort, { myField_: 'str' });
            expect2(() => payload.UpdateExpression).toBe('SET #myField_ = :myField_');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField_': 'myField_' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField_': 'str' });

            payload = dummy.prepareUpdateItem(id, sort, { myField$: 'str' });
            expect2(() => payload.UpdateExpression).toBe('SET #myField_ = :myField_');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField_': 'myField$' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField_': 'str' });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: 'str', fieldB: null });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA = :fieldA, #fieldB = :fieldB');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA', '#fieldB': 'fieldB' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA': 'str', ':fieldB': null });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: 1, fieldB: ['l', 'i', 's', 't'] });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA = :fieldA, #fieldB = :fieldB');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA', '#fieldB': 'fieldB' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA': 1, ':fieldB': ['l', 'i', 's', 't'] });
        });

        it('increment number', () => {
            payload = dummy.prepareUpdateItem(id, sort, {}, { myField: 1 });
            expect2(() => payload.UpdateExpression).toBe('ADD #myField :myField');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField': 'myField' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField': 1 });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: 'str' }, { fieldB: -1 });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA = :fieldA ADD #fieldB :fieldB');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA', '#fieldB': 'fieldB' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA': 'str', ':fieldB': -1 });
        });

        it('list append/replace/remove', () => {
            payload = dummy.prepareUpdateItem(id, sort, {}, { myField: [3, 1] } as any);
            expect2(() => payload.UpdateExpression).toBe(
                'SET #myField = list_append(if_not_exists(#myField, :myField_0), :myField)',
            );
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#myField': 'myField' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':myField': [3, 1], ':myField_0': [] });

            payload = dummy.prepareUpdateItem(id, sort, {
                fieldA: {
                    setIndex: [
                        [1, 'a'],
                        [3, 3],
                    ],
                },
            });
            expect2(() => payload.UpdateExpression).toBe('SET #fieldA[1] = :fieldA_0_, #fieldA[3] = :fieldA_1_');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({ ':fieldA_0_': 'a', ':fieldA_1_': 3 });

            payload = dummy.prepareUpdateItem(id, sort, { fieldA: { removeIndex: [2, 3] } });
            expect2(() => payload.UpdateExpression).toBe('REMOVE #fieldA[2], #fieldA[3]');
            expect2(() => payload.ExpressionAttributeNames).toEqual({ '#fieldA': 'fieldA' });
            expect2(() => payload.ExpressionAttributeValues).toEqual({});

            // all together
            payload = dummy.prepareUpdateItem(
                id,
                sort,
                { fieldA: [1, null], fieldC: { removeIndex: [1] }, fieldD: { setIndex: [[3, 3]] } },
                { fieldB: [2, 4] },
            );
            expect2(() => payload.UpdateExpression).toBe(
                'SET #fieldA = :fieldA, #fieldD[3] = :fieldD_0_, #fieldB = list_append(if_not_exists(#fieldB, :fieldB_0), :fieldB) REMOVE #fieldC[1]',
            );
            expect2(() => payload.ExpressionAttributeNames).toEqual({
                '#fieldA': 'fieldA',
                '#fieldB': 'fieldB',
                '#fieldC': 'fieldC',
                '#fieldD': 'fieldD',
            });
            expect2(() => payload.ExpressionAttributeValues).toEqual({
                ':fieldA': [1, null],
                ':fieldB': [2, 4],
                ':fieldB_0': [],
                ':fieldD_0_': 3,
            });
        });
    });

    //* dummy storage service.
    describe('DummyDynamoService', () => {
        //* load dummy storage service.
        const { dummy, tableName } = instance();

        it('should pass mutiple crud operations with dummy', async () => {
            //* check dummy data.
            expect2(dummy.hello()).toEqual(`dummy-dynamo-service:${tableName}`);

            expect2(await dummy.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - ID:00');
            expect2(await dummy.readItem('A0').catch(GETERR)).toEqual({ ID: 'A0', type: 'account', name: 'lemon' });
            expect2(await dummy.readItem('A1'), 'ID,type,name').toEqual({ ID: 'A1', type: 'account', name: 'Hong' });

            //* basic simple CRUD test.
            expect2(await dummy.readItem('A0').catch(GETERR), 'ID').toEqual({ ID: 'A0' });
            expect2(await dummy.deleteItem('A0').catch(GETERR)).toEqual(null);
            expect2(await dummy.readItem('A0').catch(GETERR), 'ID').toEqual('404 NOT FOUND - ID:A0');
            // empty string will be saved as null
            expect2(await dummy.saveItem('A0', { type: '' }).catch(GETERR), 'ID,type').toEqual({
                ID: 'A0',
                type: null,
            });
            expect2(await dummy.readItem('A0').catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: null });
            expect2(await dummy.updateItem('A0', 0, { type: 'account' }).catch(GETERR), 'ID').toEqual({ ID: 'A0' });
            expect2(await dummy.readItem('A0').catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: 'account' });

            //* check dummy data list
            expect2(dummy.hello()).toEqual(`dummy-dynamo-service:${tableName}`);
            expect2(await dummy.listItems(), '!list').toEqual({ page: 1, limit: 2, total: 3 });
            expect2(await dummy.listItems(1, 1), '!list').toEqual({ page: 1, limit: 1, total: 3 });
            expect2(await dummy.listItems(2, 2), '!list').toEqual({ page: 2, limit: 2, total: 3 });

            //* msaveItem test
            {
                // 1. validate list parameter
                //* null list
                const nullResult = await dummy.msaveItem(null as any);
                expect2(() => nullResult).toEqual({ success: [], failed: [], total: 0 });

                //* undefined list
                const undefinedResult = await dummy.msaveItem(undefined as any);
                expect2(() => undefinedResult).toEqual({ success: [], failed: [], total: 0 });

                //* empty list
                const emptyResult = await dummy.msaveItem([]);
                expect2(() => emptyResult).toEqual({ success: [], failed: [], total: 0 });

                // 2. success cases
                //* single item save
                const singleItem = [{ id: 'S0', type: 'product', name: 'Item A' }];
                const singleResult = await dummy.msaveItem(singleItem);
                expect2(() => singleResult, 'total').toEqual({ total: 1 });
                expect2(() => singleResult.success.length).toEqual(1);
                expect2(() => singleResult.failed.length).toEqual(0);
                expect2(() => singleResult.success[0], 'ID,type,name').toEqual({
                    ID: 'S0',
                    type: 'product',
                    name: 'Item A',
                });

                //* verify saved item
                expect2(await dummy.readItem('S0'), 'ID,type,name').toEqual({
                    ID: 'S0',
                    type: 'product',
                    name: 'Item A',
                });

                //* multiple items save (small batch < 25)
                const multipleItems = [
                    { id: 'S1', type: 'product', name: 'Item B' },
                    { id: 'S2', type: 'product', name: 'Item C' },
                    { id: 'S3', type: 'service', name: 'Item D' },
                ];
                const multipleResult = await dummy.msaveItem(multipleItems);
                expect2(() => multipleResult, 'total').toEqual({ total: 3 });
                expect2(() => multipleResult.success.length).toEqual(3);
                expect2(() => multipleResult.failed.length).toEqual(0);

                //* verify all saved items
                expect2(await dummy.readItem('S1'), 'ID,type,name').toEqual({
                    ID: 'S1',
                    type: 'product',
                    name: 'Item B',
                });
                expect2(await dummy.readItem('S2'), 'ID,type,name').toEqual({
                    ID: 'S2',
                    type: 'product',
                    name: 'Item C',
                });
                expect2(await dummy.readItem('S3'), 'ID,type,name').toEqual({
                    ID: 'S3',
                    type: 'service',
                    name: 'Item D',
                });

                //* overwrite existing items
                const overwriteItems = [
                    { id: 'S1', type: 'service', name: 'Item B Updated' },
                    { id: 'S2', type: 'service', name: 'Item C Updated' },
                ];
                const overwriteResult = await dummy.msaveItem(overwriteItems);
                expect2(() => overwriteResult.success.length).toEqual(2);
                expect2(await dummy.readItem('S1'), 'ID,type,name').toEqual({
                    ID: 'S1',
                    type: 'service',
                    name: 'Item B Updated',
                });
                expect2(await dummy.readItem('S2'), 'ID,type,name').toEqual({
                    ID: 'S2',
                    type: 'service',
                    name: 'Item C Updated',
                });

                // 3. edge cases
                //* empty string normalization
                const emptyStringItems = [{ id: 'S4', type: '', name: 'Empty Type' }];
                const emptyStringResult = await dummy.msaveItem(emptyStringItems);
                expect2(() => emptyStringResult.success.length).toEqual(1);
                expect2(await dummy.readItem('S4'), 'ID,type,name').toEqual({
                    ID: 'S4',
                    type: null,
                    name: 'Empty Type',
                });

                //* large batch (> 25 items to test chunking)
                const largeItems = Array.from({ length: 30 }, (_, i) => ({
                    id: `T${i}`,
                    type: 'batch',
                    name: `Item ${i}`,
                }));
                const largeResult = await dummy.msaveItem(largeItems);
                expect2(() => largeResult.total).toEqual(30);
                expect2(() => largeResult.success.length).toEqual(30);
                expect2(() => largeResult.failed.length).toEqual(0);

                //* verify some items from large batch
                expect2(await dummy.readItem('T0'), 'ID,type,name').toEqual({
                    ID: 'T0',
                    type: 'batch',
                    name: 'Item 0',
                });
                expect2(await dummy.readItem('T25'), 'ID,type,name').toEqual({
                    ID: 'T25',
                    type: 'batch',
                    name: 'Item 25',
                });
                expect2(await dummy.readItem('T29'), 'ID,type,name').toEqual({
                    ID: 'T29',
                    type: 'batch',
                    name: 'Item 29',
                });
            }

            //* mreadItem test
            {
                // 1. validate list parameter
                //* null list
                const nullResult = await dummy.mreadItem(null as any);
                expect2(() => nullResult).toEqual({ success: [], failed: [], total: 0 });

                //* undefined list
                const undefinedResult = await dummy.mreadItem(undefined as any);
                expect2(() => undefinedResult).toEqual({ success: [], failed: [], total: 0 });

                //* empty list
                const emptyResult = await dummy.mreadItem([]);
                expect2(() => emptyResult).toEqual({ success: [], failed: [], total: 0 });

                // 2. success cases
                //* prepare test data first
                await dummy.msaveItem([
                    { id: 'R0', type: 'product', name: 'Read Item A' },
                    { id: 'R1', type: 'product', name: 'Read Item B' },
                    { id: 'R2', type: 'service', name: 'Read Item C' },
                ]);

                //* single item read
                const singleRead = await dummy.mreadItem([{ id: 'R0' }]);
                expect2(() => singleRead, 'total').toEqual({ total: 1 });
                expect2(() => singleRead.success.length).toEqual(1);
                expect2(() => singleRead.failed.length).toEqual(0);
                expect2(() => singleRead.success[0], 'ID,type,name').toEqual({
                    ID: 'R0',
                    type: 'product',
                    name: 'Read Item A',
                });

                //* multiple items read (small batch < 100)
                const multipleRead = await dummy.mreadItem([{ id: 'R0' }, { id: 'R1' }, { id: 'R2' }]);
                expect2(() => multipleRead, 'total').toEqual({ total: 3 });
                expect2(() => multipleRead.success.length).toEqual(3);
                expect2(() => multipleRead.failed.length).toEqual(0);

                //* verify read items
                const items = multipleRead.success;
                expect2(() => items[0], 'ID,type,name').toEqual({ ID: 'R0', type: 'product', name: 'Read Item A' });
                expect2(() => items[1], 'ID,type,name').toEqual({ ID: 'R1', type: 'product', name: 'Read Item B' });
                expect2(() => items[2], 'ID,type,name').toEqual({ ID: 'R2', type: 'service', name: 'Read Item C' });

                // 3. edge cases
                //* read non-existent items (should fail)
                const notFoundRead = await dummy.mreadItem([{ id: 'NOT_EXISTS' }]);
                expect2(() => notFoundRead, 'total').toEqual({ total: 1 });
                expect2(() => notFoundRead.success.length).toEqual(0);
                expect2(() => notFoundRead.failed.length).toEqual(1);
                expect2(() => notFoundRead.failed[0], 'ID').toEqual({ ID: 'NOT_EXISTS' });

                //* mixed: some exist, some don't
                const mixedRead = await dummy.mreadItem([{ id: 'R0' }, { id: 'NOT_EXISTS' }, { id: 'R1' }]);
                expect2(() => mixedRead, 'total').toEqual({ total: 3 });
                expect2(() => mixedRead.success.length).toEqual(2);
                expect2(() => mixedRead.failed.length).toEqual(1);

                //* large batch (> 100 items to test chunking)
                const largeSaveItems = Array.from({ length: 110 }, (_, i) => ({
                    id: `U${i}`,
                    type: 'batch',
                    name: `Item ${i}`,
                }));
                await dummy.msaveItem(largeSaveItems);

                const largeReadKeys = Array.from({ length: 110 }, (_, i) => ({ id: `U${i}` }));
                const largeRead = await dummy.mreadItem(largeReadKeys);
                expect2(() => largeRead.total).toEqual(110);
                expect2(() => largeRead.success.length).toEqual(110);
                expect2(() => largeRead.failed.length).toEqual(0);

                //* verify some items from large batch
                const largeItems = largeRead.success;
                const item0 = largeItems.find(item => item.ID === 'U0');
                const item50 = largeItems.find(item => item.ID === 'U50');
                const item109 = largeItems.find(item => item.ID === 'U109');
                expect2(() => item0, 'ID,type,name').toEqual({ ID: 'U0', type: 'batch', name: 'Item 0' });
                expect2(() => item50, 'ID,type,name').toEqual({ ID: 'U50', type: 'batch', name: 'Item 50' });
                expect2(() => item109, 'ID,type,name').toEqual({ ID: 'U109', type: 'batch', name: 'Item 109' });
            }

            //* mupdateItem test
            {
                // 1. validate list parameter
                // null list
                const nullResult = await dummy.mupdateItem(null as any);
                expect2(() => nullResult).toEqual({ success: [], failed: [], total: 0 });

                // undefined list
                const undefinedResult = await dummy.mupdateItem(undefined as any);
                expect2(() => undefinedResult).toEqual({ success: [], failed: [], total: 0 });

                // empty list
                const emptyResult = await dummy.mupdateItem([]);
                expect2(() => emptyResult).toEqual({ success: [], failed: [], total: 0 });

                // 2. success cases
                //* single item update
                const singleItem = [{ id: 'B0', type: 'user', name: 'Alice' }];
                const singleResult = await dummy.mupdateItem(singleItem);
                expect2(() => singleResult, 'total').toEqual({ total: 1 });
                expect2(() => singleResult.success.length).toEqual(1);
                expect2(() => singleResult.failed.length).toEqual(0);
                expect2(() => singleResult.success[0], 'ID,type,name').toEqual({
                    ID: 'B0',
                    type: 'user',
                    name: 'Alice',
                });

                // verify saved item
                expect2(await dummy.readItem('B0'), 'ID,type,name').toEqual({ ID: 'B0', type: 'user', name: 'Alice' });

                //* multiple items update (small batch < 25)
                const multipleItems = [
                    { id: 'B1', type: 'user', name: 'Bob' },
                    { id: 'B2', type: 'user', name: 'Charlie' },
                    { id: 'B3', type: 'admin', name: 'David' },
                ];
                const multipleResult = await dummy.mupdateItem(multipleItems);
                expect2(() => multipleResult, 'total').toEqual({ total: 3 });
                expect2(() => multipleResult.success.length).toEqual(3);
                expect2(() => multipleResult.failed.length).toEqual(0);

                // verify all saved items
                expect2(await dummy.readItem('B1'), 'ID,type,name').toEqual({ ID: 'B1', type: 'user', name: 'Bob' });
                expect2(await dummy.readItem('B2'), 'ID,type,name').toEqual({
                    ID: 'B2',
                    type: 'user',
                    name: 'Charlie',
                });
                expect2(await dummy.readItem('B3'), 'ID,type,name').toEqual({ ID: 'B3', type: 'admin', name: 'David' });

                //* overwrite existing items
                const overwriteItems = [
                    { id: 'B1', type: 'admin', name: 'Bob Updated' },
                    { id: 'B2', type: 'admin', name: 'Charlie Updated' },
                ];
                const overwriteResult = await dummy.mupdateItem(overwriteItems);
                expect2(() => overwriteResult.success.length).toEqual(2);
                expect2(await dummy.readItem('B1'), 'ID,type,name').toEqual({
                    ID: 'B1',
                    type: 'admin',
                    name: 'Bob Updated',
                });
                expect2(await dummy.readItem('B2'), 'ID,type,name').toEqual({
                    ID: 'B2',
                    type: 'admin',
                    name: 'Charlie Updated',
                });

                // 3. edge cases
                //* empty string normalization
                const emptyStringItems = [{ id: 'B4', type: '', name: 'Empty Type' }];
                const emptyStringResult = await dummy.mupdateItem(emptyStringItems);
                expect2(() => emptyStringResult.success.length).toEqual(1);
                expect2(await dummy.readItem('B4'), 'ID,type,name').toEqual({
                    ID: 'B4',
                    type: null,
                    name: 'Empty Type',
                });

                //* large batch (> 25 items to test chunking)
                const largeItems = Array.from({ length: 30 }, (_, i) => ({
                    id: `C${i}`,
                    type: 'batch',
                    name: `Item ${i}`,
                }));
                const largeResult = await dummy.mupdateItem(largeItems);
                expect2(() => largeResult.total).toEqual(30);
                expect2(() => largeResult.success.length).toEqual(30);
                expect2(() => largeResult.failed.length).toEqual(0);

                // verify some items from large batch
                expect2(await dummy.readItem('C0'), 'ID,type,name').toEqual({
                    ID: 'C0',
                    type: 'batch',
                    name: 'Item 0',
                });
                expect2(await dummy.readItem('C25'), 'ID,type,name').toEqual({
                    ID: 'C25',
                    type: 'batch',
                    name: 'Item 25',
                });
                expect2(await dummy.readItem('C29'), 'ID,type,name').toEqual({
                    ID: 'C29',
                    type: 'batch',
                    name: 'Item 29',
                });
            }

            //* multiple crud operations (100+ items)
            {
                const count = 120;

                //* msaveItem (100+ items)
                const saveItems = Array.from({ length: count }, (_, i) => ({
                    id: `ZD${i}`,
                    type: 'dummy-multi',
                    name: `Multi ${i}`,
                }));
                const saveResult = await dummy.msaveItem(saveItems);
                expect2(() => saveResult.total).toEqual(count);
                expect2(() => saveResult.success.length).toEqual(count);
                expect2(() => saveResult.failed.length).toEqual(0);

                //* mreadItem (100+ items)
                const readKeys = saveItems.map(item => ({ id: item.id }));
                const readResult = await dummy.mreadItem(readKeys);
                expect2(() => readResult.total).toEqual(count);
                expect2(() => readResult.success.length).toEqual(count);
                expect2(() => readResult.failed.length).toEqual(0);
                const readSample0 = readResult.success.find(item => item.ID === 'ZD0');
                const readSample60 = readResult.success.find(item => item.ID === 'ZD60');
                const readSample119 = readResult.success.find(item => item.ID === 'ZD119');
                expect2(() => readSample0, 'ID,type,name').toEqual({
                    ID: 'ZD0',
                    type: 'dummy-multi',
                    name: 'Multi 0',
                });
                expect2(() => readSample60, 'ID,type,name').toEqual({
                    ID: 'ZD60',
                    type: 'dummy-multi',
                    name: 'Multi 60',
                });
                expect2(() => readSample119, 'ID,type,name').toEqual({
                    ID: 'ZD119',
                    type: 'dummy-multi',
                    name: 'Multi 119',
                });

                //* mupdateItem (100+ items)
                const updateItems = Array.from({ length: count }, (_, i) => ({
                    id: `ZD${i}`,
                    type: 'dummy-multi-updated',
                    name: `Multi Updated ${i}`,
                }));
                const updateResult = await dummy.mupdateItem(updateItems);
                expect2(() => updateResult.total).toEqual(count);
                expect2(() => updateResult.success.length).toEqual(count);
                expect2(() => updateResult.failed.length).toEqual(0);

                //* verify updated items
                expect2(await dummy.readItem('ZD0'), 'ID,type,name').toEqual({
                    ID: 'ZD0',
                    type: 'dummy-multi-updated',
                    name: 'Multi Updated 0',
                });
                expect2(await dummy.readItem('ZD60'), 'ID,type,name').toEqual({
                    ID: 'ZD60',
                    type: 'dummy-multi-updated',
                    name: 'Multi Updated 60',
                });
                expect2(await dummy.readItem('ZD119'), 'ID,type,name').toEqual({
                    ID: 'ZD119',
                    type: 'dummy-multi-updated',
                    name: 'Multi Updated 119',
                });
            }

            //* LAYER EQUIVALENCE: batch vs legacy methods
            if (1) {
                //* test of mreadItem vs readItem
                const readItems = [
                    { id: 'equiv-read-1', type: 'equiv-test', name: 'Equiv Read 1' },
                    { id: 'equiv-read-2', type: 'equiv-test', name: 'Equiv Read 2' },
                    { id: 'equiv-read-3', type: 'equiv-test', name: 'Equiv Read 3' },
                ];
                await dummy.msaveItem(readItems);

                // Legacy: multiple readItem calls
                const legacy1 = await dummy.readItem('equiv-read-1');
                const legacy2 = await dummy.readItem('equiv-read-2');
                const legacy3 = await dummy.readItem('equiv-read-3');

                // Batch: single mreadItem call
                const batchRead = await dummy.mreadItem([
                    { id: 'equiv-read-1' },
                    { id: 'equiv-read-2' },
                    { id: 'equiv-read-3' },
                ]);

                // Verify equivalence
                expect2(() => batchRead.success.length).toEqual(3);
                expect2(() => batchRead.success[0]).toEqual(legacy1);
                expect2(() => batchRead.success[1]).toEqual(legacy2);
                expect2(() => batchRead.success[2]).toEqual(legacy3);

                //* test of msaveItem vs saveItem
                const saveItems = [
                    { id: 'equiv-save-1', type: 'equiv-test', name: 'Equiv Save 1' },
                    { id: 'equiv-save-2', type: 'equiv-test', name: 'Equiv Save 2' },
                    { id: 'equiv-save-3', type: 'equiv-test', name: 'Equiv Save 3' },
                ];

                // Legacy: multiple saveItem calls
                const legacySave1 = await dummy.saveItem('equiv-save-1', {
                    type: 'equiv-test',
                    name: 'Equiv Save 1',
                } as MyModel);
                const legacySave2 = await dummy.saveItem('equiv-save-2', {
                    type: 'equiv-test',
                    name: 'Equiv Save 2',
                } as MyModel);
                const legacySave3 = await dummy.saveItem('equiv-save-3', {
                    type: 'equiv-test',
                    name: 'Equiv Save 3',
                } as MyModel);

                // Cleanup for batch test
                await dummy.deleteItem('equiv-save-1');
                await dummy.deleteItem('equiv-save-2');
                await dummy.deleteItem('equiv-save-3');

                // Verify items are deleted
                expect2(await dummy.readItem('equiv-save-1').catch(GETERR)).toEqual('404 NOT FOUND - ID:equiv-save-1');
                expect2(await dummy.readItem('equiv-save-2').catch(GETERR)).toEqual('404 NOT FOUND - ID:equiv-save-2');
                expect2(await dummy.readItem('equiv-save-3').catch(GETERR)).toEqual('404 NOT FOUND - ID:equiv-save-3');

                // Batch: single msaveItem call
                const batchSave = await dummy.msaveItem(saveItems);

                // Verify equivalence
                expect2(() => batchSave.success.length).toEqual(3);
                expect2(() => batchSave.success[0]).toEqual(legacySave1);
                expect2(() => batchSave.success[1]).toEqual(legacySave2);
                expect2(() => batchSave.success[2]).toEqual(legacySave3);

                //* test of mupdateItem vs updateItem
                const initialItems = [
                    { id: 'equiv-update-1', type: 'equiv-test', name: 'Initial 1' },
                    { id: 'equiv-update-2', type: 'equiv-test', name: 'Initial 2' },
                    { id: 'equiv-update-3', type: 'equiv-test', name: 'Initial 3' },
                ];
                await dummy.msaveItem(initialItems);

                // Legacy: multiple updateItem calls
                const legacyUpdate1 = await dummy.updateItem('equiv-update-1', 0, {
                    type: 'equiv-updated',
                    name: 'Updated 1',
                });
                const legacyUpdate2 = await dummy.updateItem('equiv-update-2', 0, {
                    type: 'equiv-updated',
                    name: 'Updated 2',
                });
                const legacyUpdate3 = await dummy.updateItem('equiv-update-3', 0, {
                    type: 'equiv-updated',
                    name: 'Updated 3',
                });

                // Reset data for batch test
                await dummy.msaveItem(initialItems);

                // Batch: single mupdateItem call
                const updateItems = [
                    { id: 'equiv-update-1', type: 'equiv-updated', name: 'Updated 1' },
                    { id: 'equiv-update-2', type: 'equiv-updated', name: 'Updated 2' },
                    { id: 'equiv-update-3', type: 'equiv-updated', name: 'Updated 3' },
                ];
                const batchUpdate = await dummy.mupdateItem(updateItems);

                // Verify equivalence
                expect2(() => batchUpdate.success.length).toEqual(3);
                expect2(() => batchUpdate.success[0]).toEqual(legacyUpdate1);
                expect2(() => batchUpdate.success[1]).toEqual(legacyUpdate2);
                expect2(() => batchUpdate.success[2]).toEqual(legacyUpdate3);

                //* msaveItem failure cases
                // test circular reference error
                const circular: any = { id: 'fail-circular-1', type: 'test', name: 'Circular' };
                circular.self = circular; // circular reference causes JSON serialization error

                const msaveFailResult = await dummy.msaveItem([
                    { id: 'fail-good-1', type: 'test', name: 'Good 1' },
                    circular, // this will fail
                    { id: 'fail-good-2', type: 'test', name: 'Good 2' },
                ]);

                expect2(() => msaveFailResult.total).toEqual(3);
                expect2(() => msaveFailResult.success.length).toEqual(2);
                expect2(() => msaveFailResult.failed.length).toEqual(1);

                // verify successful items were saved
                expect2(await dummy.readItem('fail-good-1'), 'ID,type,name').toEqual({
                    ID: 'fail-good-1',
                    type: 'test',
                    name: 'Good 1',
                });
                expect2(await dummy.readItem('fail-good-2'), 'ID,type,name').toEqual({
                    ID: 'fail-good-2',
                    type: 'test',
                    name: 'Good 2',
                });

                // verify failed item is in failed array
                expect2(() => msaveFailResult.failed[0], 'id').toEqual({ id: 'fail-circular-1' });

                //* mupdateItem failure cases
                // test circular reference error
                const circular2: any = { id: 'fail-circular-2', type: 'test', name: 'Circular Update' };
                circular2.self = circular2; // circular reference

                const mupdateFailResult = await dummy.mupdateItem([
                    { id: 'fail-update-1', type: 'test', name: 'Update 1' },
                    circular2, // this will fail
                    { id: 'fail-update-2', type: 'test', name: 'Update 2' },
                ]);

                expect2(() => mupdateFailResult.total).toEqual(3);
                expect2(() => mupdateFailResult.success.length).toEqual(2);
                expect2(() => mupdateFailResult.failed.length).toEqual(1);

                // verify successful items were saved
                expect2(await dummy.readItem('fail-update-1'), 'ID,type,name').toEqual({
                    ID: 'fail-update-1',
                    type: 'test',
                    name: 'Update 1',
                });
                expect2(await dummy.readItem('fail-update-2'), 'ID,type,name').toEqual({
                    ID: 'fail-update-2',
                    type: 'test',
                    name: 'Update 2',
                });

                // verify failed item is in failed array
                expect2(() => mupdateFailResult.failed[0], 'ID').toEqual({ ID: 'fail-circular-2' });
            }
        });
    });

    //* real DynamoDB storage service.
    describe('DynamoService (real)', () => {
        const { service, tableName } = instance();
        const dataMap = new Map<string, MyModel>();

        beforeAll(async () => {
            if (!PROFILE) return;

            // Initialize data in the table
            const data: MyModel[] = loadDataYml('dummy-dynamo-data.yml').data;
            await data.map(async item => {
                const saved = await service.saveItem(item.ID, item);
                dataMap.set(saved.ID, saved); // Store into map
            });
        });

        it('should pass mutiple crud operations with real DynamoDB', async () => {
            vi.setConfig({ testTimeout: 30000 }); // Increase timeout for equivalence tests
            if (!PROFILE) return;

            //* basic CRUD
            {
                //* check dummy data.
                expect2(service.hello()).toEqual(`dynamo-service:${tableName}`);
                expect2(await service.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - ID:00');
                expect2(await service.readItem('A0').catch(GETERR)).toEqual({
                    ID: 'A0',
                    type: 'account',
                    name: 'lemon',
                });
                expect2(await service.readItem('A1').catch(GETERR), 'ID,type,name').toEqual({
                    ID: 'A1',
                    type: 'account',
                    name: 'Hong',
                });

                //* basic simple CRUD test.
                expect2(await service.readItem('A0').catch(GETERR), 'ID').toEqual({ ID: 'A0' });
                expect2(await service.deleteItem('A0').catch(GETERR)).toEqual(null);
                expect2(await service.readItem('A0').catch(GETERR), 'ID').toEqual('404 NOT FOUND - ID:A0');
                // empty string will be saved as null
                expect2(await service.saveItem('A0', { type: '' }).catch(GETERR), 'ID,type').toEqual({
                    ID: 'A0',
                    type: null,
                });
                expect2(await service.readItem('A0').catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: null });
                expect2(await service.updateItem('A0', 0, { type: 'account' }).catch(GETERR), 'ID').toEqual({
                    ID: 'A0',
                });
                expect2(await service.readItem('A0').catch(GETERR), 'ID,type').toEqual({ ID: 'A0', type: 'account' });
            }

            //* msaveItem test
            {
                // 1. validate list parameter
                //* null list
                const nullResult = await service.msaveItem(null as any);
                expect2(() => nullResult).toEqual({ success: [], failed: [], total: 0 });

                //* undefined list
                const undefinedResult = await service.msaveItem(undefined as any);
                expect2(() => undefinedResult).toEqual({ success: [], failed: [], total: 0 });

                //* empty list
                const emptyResult = await service.msaveItem([]);
                expect2(() => emptyResult).toEqual({ success: [], failed: [], total: 0 });

                // 2. success cases
                //* single item save
                const singleItem = [{ id: 'F0', type: 'real-product', name: 'Item A' }];
                const singleResult = await service.msaveItem(singleItem);
                dataMap.set('F0', singleItem[0] as MyModel);
                expect2(() => singleResult, 'total').toEqual({ total: 1 });
                expect2(() => singleResult.success.length).toEqual(1);
                expect2(() => singleResult.failed.length).toEqual(0);
                expect2(() => singleResult.success[0], 'ID,type,name').toEqual({
                    ID: 'F0',
                    type: 'real-product',
                    name: 'Item A',
                });

                //* verify saved item
                expect2(await service.readItem('F0'), 'ID,type,name').toEqual({
                    ID: 'F0',
                    type: 'real-product',
                    name: 'Item A',
                });

                //* multiple items save (small batch < 25)
                const multipleItems = [
                    { id: 'F1', type: 'real-product', name: 'Item B' },
                    { id: 'F2', type: 'real-product', name: 'Item C' },
                    { id: 'F3', type: 'real-service', name: 'Item D' },
                ];
                const multipleResult = await service.msaveItem(multipleItems);
                multipleItems.forEach(item => dataMap.set(item.id, item as MyModel));
                expect2(() => multipleResult, 'total').toEqual({ total: 3 });
                expect2(() => multipleResult.success.length).toEqual(3);
                expect2(() => multipleResult.failed.length).toEqual(0);

                //* verify all saved items
                expect2(await service.readItem('F1'), 'ID,type,name').toEqual({
                    ID: 'F1',
                    type: 'real-product',
                    name: 'Item B',
                });
                expect2(await service.readItem('F2'), 'ID,type,name').toEqual({
                    ID: 'F2',
                    type: 'real-product',
                    name: 'Item C',
                });
                expect2(await service.readItem('F3'), 'ID,type,name').toEqual({
                    ID: 'F3',
                    type: 'real-service',
                    name: 'Item D',
                });

                //* overwrite existing items
                const overwriteItems = [
                    { id: 'F1', type: 'real-service', name: 'Item B Updated' },
                    { id: 'F2', type: 'real-service', name: 'Item C Updated' },
                ];
                const overwriteResult = await service.msaveItem(overwriteItems);
                expect2(() => overwriteResult.success.length).toEqual(2);
                expect2(await service.readItem('F1'), 'ID,type,name').toEqual({
                    ID: 'F1',
                    type: 'real-service',
                    name: 'Item B Updated',
                });
                expect2(await service.readItem('F2'), 'ID,type,name').toEqual({
                    ID: 'F2',
                    type: 'real-service',
                    name: 'Item C Updated',
                });

                // 3. edge cases
                //* empty string normalization
                const emptyStringItems = [{ id: 'F4', type: '', name: 'Empty Type' }];
                const emptyStringResult = await service.msaveItem(emptyStringItems);
                dataMap.set('F4', emptyStringItems[0] as MyModel);
                expect2(() => emptyStringResult.success.length).toEqual(1);
                expect2(await service.readItem('F4'), 'ID,type,name').toEqual({
                    ID: 'F4',
                    type: null,
                    name: 'Empty Type',
                });

                //* large batch (> 25 items to test chunking)
                const largeItems = Array.from({ length: 30 }, (_, i) => ({
                    id: `G${i}`,
                    type: 'real-batch',
                    name: `Item ${i}`,
                }));
                const largeResult = await service.msaveItem(largeItems);
                largeItems.forEach(item => dataMap.set(item.id, item as MyModel));
                expect2(() => largeResult.total).toEqual(30);
                expect2(() => largeResult.success.length).toEqual(30);
                expect2(() => largeResult.failed.length).toEqual(0);

                //* verify some items from large batch
                expect2(await service.readItem('G0'), 'ID,type,name').toEqual({
                    ID: 'G0',
                    type: 'real-batch',
                    name: 'Item 0',
                });
                expect2(await service.readItem('G25'), 'ID,type,name').toEqual({
                    ID: 'G25',
                    type: 'real-batch',
                    name: 'Item 25',
                });
                expect2(await service.readItem('G29'), 'ID,type,name').toEqual({
                    ID: 'G29',
                    type: 'real-batch',
                    name: 'Item 29',
                });
            }

            //* mreadItem test
            {
                // 1. validate list parameter
                //* null list
                const nullResult = await service.mreadItem(null as any);
                expect2(() => nullResult).toEqual({ success: [], failed: [], total: 0 });

                //* undefined list
                const undefinedResult = await service.mreadItem(undefined as any);
                expect2(() => undefinedResult).toEqual({ success: [], failed: [], total: 0 });

                //* empty list
                const emptyResult = await service.mreadItem([]);
                expect2(() => emptyResult).toEqual({ success: [], failed: [], total: 0 });

                // 2. success cases
                //* prepare test data first
                const prepareItems = [
                    { id: 'H0', type: 'real-product', name: 'Read Item A' },
                    { id: 'H1', type: 'real-product', name: 'Read Item B' },
                    { id: 'H2', type: 'real-service', name: 'Read Item C' },
                ];
                await service.msaveItem(prepareItems);
                prepareItems.forEach(item => dataMap.set(item.id, item as MyModel));

                //* single item read
                const singleRead = await service.mreadItem([{ id: 'H0' }]);
                expect2(() => singleRead, 'total').toEqual({ total: 1 });
                expect2(() => singleRead.success.length).toEqual(1);
                expect2(() => singleRead.failed.length).toEqual(0);
                expect2(() => singleRead.success[0], 'ID,type,name').toEqual({
                    ID: 'H0',
                    type: 'real-product',
                    name: 'Read Item A',
                });

                //* multiple items read (small batch < 100)
                const multipleRead = await service.mreadItem([{ id: 'H0' }, { id: 'H1' }, { id: 'H2' }]);
                expect2(() => multipleRead, 'total').toEqual({ total: 3 });
                expect2(() => multipleRead.success.length).toEqual(3);
                expect2(() => multipleRead.failed.length).toEqual(0);

                //* verify read items
                const items = multipleRead.success;
                const item0 = items.find(item => item.ID === 'H0');
                const item1 = items.find(item => item.ID === 'H1');
                const item2 = items.find(item => item.ID === 'H2');
                expect2(() => item0, 'ID,type,name').toEqual({
                    ID: 'H0',
                    type: 'real-product',
                    name: 'Read Item A',
                });
                expect2(() => item1, 'ID,type,name').toEqual({
                    ID: 'H1',
                    type: 'real-product',
                    name: 'Read Item B',
                });
                expect2(() => item2, 'ID,type,name').toEqual({
                    ID: 'H2',
                    type: 'real-service',
                    name: 'Read Item C',
                });

                // 3. edge cases
                //* read non-existent items (should fail)
                const notFoundRead = await service.mreadItem([{ id: 'NOT_EXISTS_REAL' }]);
                expect2(() => notFoundRead, 'total').toEqual({ total: 1 });
                expect2(() => notFoundRead.success.length).toEqual(0);
                expect2(() => notFoundRead.failed.length).toEqual(1);
                expect2(() => notFoundRead.failed[0], 'ID').toEqual({ ID: 'NOT_EXISTS_REAL' });

                //* mixed: some exist, some don't
                const mixedRead = await service.mreadItem([{ id: 'H0' }, { id: 'NOT_EXISTS_REAL2' }, { id: 'H1' }]);
                expect2(() => mixedRead, 'total').toEqual({ total: 3 });
                expect2(() => mixedRead.success.length).toEqual(2);
                expect2(() => mixedRead.failed.length).toEqual(1);

                //* large batch (> 100 items to test chunking)
                const largeSaveItems = Array.from({ length: 110 }, (_, i) => ({
                    id: `I${i}`,
                    type: 'real-batch',
                    name: `Item ${i}`,
                }));
                await service.msaveItem(largeSaveItems);
                largeSaveItems.forEach(item => dataMap.set(item.id, item as MyModel));

                const largeReadKeys = Array.from({ length: 110 }, (_, i) => ({ id: `I${i}` }));
                const largeRead = await service.mreadItem(largeReadKeys);
                expect2(() => largeRead.total).toEqual(110);
                expect2(() => largeRead.success.length).toEqual(110);
                expect2(() => largeRead.failed.length).toEqual(0);

                //* verify some items from large batch
                const largeItems = largeRead.success;
                const largeItem0 = largeItems.find(item => item.ID === 'I0');
                const largeItem50 = largeItems.find(item => item.ID === 'I50');
                const largeItem109 = largeItems.find(item => item.ID === 'I109');
                expect2(() => largeItem0, 'ID,type,name').toEqual({
                    ID: 'I0',
                    type: 'real-batch',
                    name: 'Item 0',
                });
                expect2(() => largeItem50, 'ID,type,name').toEqual({
                    ID: 'I50',
                    type: 'real-batch',
                    name: 'Item 50',
                });
                expect2(() => largeItem109, 'ID,type,name').toEqual({
                    ID: 'I109',
                    type: 'real-batch',
                    name: 'Item 109',
                });
            }

            //* mupdateItem test
            {
                // 1. validate list parameter
                // null list
                const nullResult = await service.mupdateItem(null as any);
                expect2(() => nullResult).toEqual({ success: [], failed: [], total: 0 });

                // undefined list
                const undefinedResult = await service.mupdateItem(undefined as any);
                expect2(() => undefinedResult).toEqual({ success: [], failed: [], total: 0 });

                // empty list
                const emptyResult = await service.mupdateItem([]);
                expect2(() => emptyResult).toEqual({ success: [], failed: [], total: 0 });

                // 2. success cases
                //* single item update
                const singleItem = [{ id: 'D0', type: 'real-user', name: 'Alice' }];
                const singleResult = await service.mupdateItem(singleItem);
                dataMap.set('D0', singleItem[0] as MyModel);
                expect2(() => singleResult, 'total').toEqual({ total: 1 });
                expect2(() => singleResult.success.length).toEqual(1);
                expect2(() => singleResult.failed.length).toEqual(0);
                expect2(() => singleResult.success[0], 'ID,type,name').toEqual({
                    ID: 'D0',
                    type: 'real-user',
                    name: 'Alice',
                });

                // verify saved item
                expect2(await service.readItem('D0'), 'ID,type,name').toEqual({
                    ID: 'D0',
                    type: 'real-user',
                    name: 'Alice',
                });

                //* multiple items update (small batch < 25)
                const multipleItems = [
                    { id: 'D1', type: 'real-user', name: 'Bob' },
                    { id: 'D2', type: 'real-user', name: 'Charlie' },
                    { id: 'D3', type: 'real-admin', name: 'David' },
                ];
                const multipleResult = await service.mupdateItem(multipleItems);
                multipleItems.forEach(item => dataMap.set(item.id, item as MyModel));
                expect2(() => multipleResult, 'total').toEqual({ total: 3 });
                expect2(() => multipleResult.success.length).toEqual(3);
                expect2(() => multipleResult.failed.length).toEqual(0);

                // verify all saved items
                expect2(await service.readItem('D1'), 'ID,type,name').toEqual({
                    ID: 'D1',
                    type: 'real-user',
                    name: 'Bob',
                });
                expect2(await service.readItem('D2'), 'ID,type,name').toEqual({
                    ID: 'D2',
                    type: 'real-user',
                    name: 'Charlie',
                });
                expect2(await service.readItem('D3'), 'ID,type,name').toEqual({
                    ID: 'D3',
                    type: 'real-admin',
                    name: 'David',
                });

                //* overwrite existing items
                const overwriteItems = [
                    { id: 'D1', type: 'real-admin', name: 'Bob Updated' },
                    { id: 'D2', type: 'real-admin', name: 'Charlie Updated' },
                ];
                const overwriteResult = await service.mupdateItem(overwriteItems);
                expect2(() => overwriteResult.success.length).toEqual(2);
                expect2(await service.readItem('D1'), 'ID,type,name').toEqual({
                    ID: 'D1',
                    type: 'real-admin',
                    name: 'Bob Updated',
                });
                expect2(await service.readItem('D2'), 'ID,type,name').toEqual({
                    ID: 'D2',
                    type: 'real-admin',
                    name: 'Charlie Updated',
                });

                // 3. edge cases
                //* empty string normalization
                const emptyStringItems = [{ id: 'D4', type: '', name: 'Empty Type' }];
                const emptyStringResult = await service.mupdateItem(emptyStringItems);
                dataMap.set('D4', emptyStringItems[0] as MyModel);
                expect2(() => emptyStringResult.success.length).toEqual(1);
                expect2(await service.readItem('D4'), 'ID,type,name').toEqual({
                    ID: 'D4',
                    type: null,
                    name: 'Empty Type',
                });

                //* large batch (> 25 items to test chunking)
                const largeItems = Array.from({ length: 30 }, (_, i) => ({
                    id: `E${i}`,
                    type: 'real-batch',
                    name: `Item ${i}`,
                }));
                const largeResult = await service.mupdateItem(largeItems);
                largeItems.forEach(item => dataMap.set(item.id, item as MyModel));
                expect2(() => largeResult.total).toEqual(30);
                expect2(() => largeResult.success.length).toEqual(30);
                expect2(() => largeResult.failed.length).toEqual(0);

                // verify some items from large batch
                expect2(await service.readItem('E0'), 'ID,type,name').toEqual({
                    ID: 'E0',
                    type: 'real-batch',
                    name: 'Item 0',
                });
                expect2(await service.readItem('E25'), 'ID,type,name').toEqual({
                    ID: 'E25',
                    type: 'real-batch',
                    name: 'Item 25',
                });
                expect2(await service.readItem('E29'), 'ID,type,name').toEqual({
                    ID: 'E29',
                    type: 'real-batch',
                    name: 'Item 29',
                });
            }

            //* multiple crud operations (100+ items)
            {
                const count = 120;

                //* msaveItem (100+ items)
                const saveItems = Array.from({ length: count }, (_, i) => ({
                    id: `Z${i}`,
                    type: 'real-multi',
                    name: `Multi ${i}`,
                }));
                const saveResult = await service.msaveItem(saveItems);
                saveItems.forEach(item => dataMap.set(item.id, item as MyModel));
                expect2(() => saveResult.total).toEqual(count);
                expect2(() => saveResult.success.length).toEqual(count);
                expect2(() => saveResult.failed.length).toEqual(0);

                //* mreadItem (100+ items)
                const readKeys = saveItems.map(item => ({ id: item.id }));
                const readResult = await service.mreadItem(readKeys);
                expect2(() => readResult.total).toEqual(count);
                expect2(() => readResult.success.length).toEqual(count);
                expect2(() => readResult.failed.length).toEqual(0);
                const readSample0 = readResult.success.find(item => item.ID === 'Z0');
                const readSample60 = readResult.success.find(item => item.ID === 'Z60');
                const readSample119 = readResult.success.find(item => item.ID === 'Z119');
                expect2(() => readSample0, 'ID,type,name').toEqual({
                    ID: 'Z0',
                    type: 'real-multi',
                    name: 'Multi 0',
                });
                expect2(() => readSample60, 'ID,type,name').toEqual({
                    ID: 'Z60',
                    type: 'real-multi',
                    name: 'Multi 60',
                });
                expect2(() => readSample119, 'ID,type,name').toEqual({
                    ID: 'Z119',
                    type: 'real-multi',
                    name: 'Multi 119',
                });

                //* mupdateItem (100+ items)
                const updateItems = Array.from({ length: count }, (_, i) => ({
                    id: `Z${i}`,
                    type: 'real-multi-updated',
                    name: `Multi Updated ${i}`,
                }));
                const updateResult = await service.mupdateItem(updateItems);
                updateItems.forEach(item => dataMap.set(item.id, item as MyModel));
                expect2(() => updateResult.total).toEqual(count);
                expect2(() => updateResult.success.length).toEqual(count);
                expect2(() => updateResult.failed.length).toEqual(0);

                //* verify updated items
                expect2(await service.readItem('Z0'), 'ID,type,name').toEqual({
                    ID: 'Z0',
                    type: 'real-multi-updated',
                    name: 'Multi Updated 0',
                });
                expect2(await service.readItem('Z60'), 'ID,type,name').toEqual({
                    ID: 'Z60',
                    type: 'real-multi-updated',
                    name: 'Multi Updated 60',
                });
                expect2(await service.readItem('Z119'), 'ID,type,name').toEqual({
                    ID: 'Z119',
                    type: 'real-multi-updated',
                    name: 'Multi Updated 119',
                });
            }

            //* LAYER EQUIVALENCE: batch vs legacy methods
            if (1) {
                //* test of mreadItem vs readItem
                const readItems = [
                    { id: 'real-equiv-read-1', type: 'real-equiv-test', name: 'Real Equiv Read 1' },
                    { id: 'real-equiv-read-2', type: 'real-equiv-test', name: 'Real Equiv Read 2' },
                    { id: 'real-equiv-read-3', type: 'real-equiv-test', name: 'Real Equiv Read 3' },
                ];
                await service.msaveItem(readItems);
                dataMap.set('real-equiv-read-1', readItems[0] as MyModel);
                dataMap.set('real-equiv-read-2', readItems[1] as MyModel);
                dataMap.set('real-equiv-read-3', readItems[2] as MyModel);

                // Legacy: multiple readItem calls
                const realLegacy1 = await service.readItem('real-equiv-read-1');
                const realLegacy2 = await service.readItem('real-equiv-read-2');
                const realLegacy3 = await service.readItem('real-equiv-read-3');

                // Batch: single mreadItem call
                const realBatchRead = await service.mreadItem([
                    { id: 'real-equiv-read-1' },
                    { id: 'real-equiv-read-2' },
                    { id: 'real-equiv-read-3' },
                ]);

                // Verify equivalence
                expect2(() => realBatchRead.success.length).toEqual(3);
                expect2(() => realBatchRead.success[0]).toEqual(realLegacy1);
                expect2(() => realBatchRead.success[1]).toEqual(realLegacy2);
                expect2(() => realBatchRead.success[2]).toEqual(realLegacy3);

                //* test of msaveItem vs saveItem
                const saveItems = [
                    { id: 'real-equiv-save-1', type: 'real-equiv-test', name: 'Real Equiv Save 1' },
                    { id: 'real-equiv-save-2', type: 'real-equiv-test', name: 'Real Equiv Save 2' },
                    { id: 'real-equiv-save-3', type: 'real-equiv-test', name: 'Real Equiv Save 3' },
                ];

                // Legacy: multiple saveItem calls
                const realLegacySave1 = await service.saveItem('real-equiv-save-1', {
                    type: 'real-equiv-test',
                    name: 'Real Equiv Save 1',
                } as MyModel);
                dataMap.set('real-equiv-save-1', realLegacySave1);
                const realLegacySave2 = await service.saveItem('real-equiv-save-2', {
                    type: 'real-equiv-test',
                    name: 'Real Equiv Save 2',
                } as MyModel);
                dataMap.set('real-equiv-save-2', realLegacySave2);
                const realLegacySave3 = await service.saveItem('real-equiv-save-3', {
                    type: 'real-equiv-test',
                    name: 'Real Equiv Save 3',
                } as MyModel);
                dataMap.set('real-equiv-save-3', realLegacySave3);

                // Cleanup and prepare for batch test
                await service.deleteItem('real-equiv-save-1');
                dataMap.delete('real-equiv-save-1');
                await service.deleteItem('real-equiv-save-2');
                dataMap.delete('real-equiv-save-2');
                await service.deleteItem('real-equiv-save-3');
                dataMap.delete('real-equiv-save-3');

                // Verify items are deleted
                expect2(await service.readItem('real-equiv-save-1').catch(GETERR)).toEqual(
                    '404 NOT FOUND - ID:real-equiv-save-1',
                );
                expect2(await service.readItem('real-equiv-save-2').catch(GETERR)).toEqual(
                    '404 NOT FOUND - ID:real-equiv-save-2',
                );
                expect2(await service.readItem('real-equiv-save-3').catch(GETERR)).toEqual(
                    '404 NOT FOUND - ID:real-equiv-save-3',
                );

                // Batch: single msaveItem call
                const realBatchSave = await service.msaveItem(saveItems);
                dataMap.set((realBatchSave.success[0] as any).ID, realBatchSave.success[0]);
                dataMap.set((realBatchSave.success[1] as any).ID, realBatchSave.success[1]);
                dataMap.set((realBatchSave.success[2] as any).ID, realBatchSave.success[2]);

                // Verify equivalence
                expect2(() => realBatchSave.success.length).toEqual(3);
                expect2(() => realBatchSave.success[0]).toEqual(realLegacySave1);
                expect2(() => realBatchSave.success[1]).toEqual(realLegacySave2);
                expect2(() => realBatchSave.success[2]).toEqual(realLegacySave3);

                //* test of mupdateItem vs updateItem
                const initialItems = [
                    { id: 'real-equiv-update-1', type: 'real-equiv-test', name: 'Real Initial 1' },
                    { id: 'real-equiv-update-2', type: 'real-equiv-test', name: 'Real Initial 2' },
                    { id: 'real-equiv-update-3', type: 'real-equiv-test', name: 'Real Initial 3' },
                ];
                await service.msaveItem(initialItems);
                dataMap.set('real-equiv-update-1', initialItems[0] as MyModel);
                dataMap.set('real-equiv-update-2', initialItems[1] as MyModel);
                dataMap.set('real-equiv-update-3', initialItems[2] as MyModel);

                // Legacy: multiple updateItem calls
                const realLegacyUpdate1 = await service.updateItem('real-equiv-update-1', 0, {
                    type: 'real-equiv-updated',
                    name: 'Real Updated 1',
                });
                const realLegacyUpdate2 = await service.updateItem('real-equiv-update-2', 0, {
                    type: 'real-equiv-updated',
                    name: 'Real Updated 2',
                });
                const realLegacyUpdate3 = await service.updateItem('real-equiv-update-3', 0, {
                    type: 'real-equiv-updated',
                    name: 'Real Updated 3',
                });

                // Reset data for batch test
                await service.msaveItem(initialItems);

                // Batch: single mupdateItem call
                const updateItems = [
                    { id: 'real-equiv-update-1', type: 'real-equiv-updated', name: 'Real Updated 1' },
                    { id: 'real-equiv-update-2', type: 'real-equiv-updated', name: 'Real Updated 2' },
                    { id: 'real-equiv-update-3', type: 'real-equiv-updated', name: 'Real Updated 3' },
                ];
                const realBatchUpdate = await service.mupdateItem(updateItems);

                // Verify equivalence
                expect2(() => realBatchUpdate.success.length).toEqual(3);
                expect2(() => realBatchUpdate.success[0]).toEqual(realLegacyUpdate1);
                expect2(() => realBatchUpdate.success[1]).toEqual(realLegacyUpdate2);
                expect2(() => realBatchUpdate.success[2]).toEqual(realLegacyUpdate3);
            }

            //* CRITICAL TEST: UpdateCommand vs PutRequest equivalence
            {
                // Setup: create item with multiple fields for direct comparison
                const testItem = {
                    id: 'update-equiv-compare',
                    type: 'update-equiv-test',
                    name: 'Original',
                    count: 100,
                    extraField: 'extra-data',
                    keepMe: 'should-persist',
                };
                await service.msaveItem([testItem]);
                dataMap.set(testItem.id, testItem as MyModel);

                // Legacy: updateItem (UpdateCommand) - partial update
                await service.updateItem(testItem.id, 0, { name: 'Updated via UpdateCommand' });
                const legacyResult = await service.readItem(testItem.id);

                // Reset to original state for batch test
                await service.msaveItem([testItem]);

                // Batch: mupdateItem (PutRequest) with full model - same update
                const currentState = await service.readItem(testItem.id);
                await service.mupdateItem([
                    {
                        id: testItem.id,
                        ...currentState,
                        name: 'Updated via UpdateCommand', // Same update as legacy
                    } as any,
                ]);
                const batchResult = await service.readItem(testItem.id);

                // Direct comparison: both methods should produce identical results
                expect2(() => batchResult).toEqual(legacyResult);
                expect2(() => batchResult.name).toEqual('Updated via UpdateCommand');
                expect2(() => (batchResult as any).count).toEqual(100);
                expect2(() => (batchResult as any).extraField).toEqual('extra-data');
                expect2(() => (batchResult as any).keepMe).toEqual('should-persist');

                // Critical: mupdateItem WITHOUT full model loses fields (PutRequest overwrites)
                const testPartialId = 'update-equiv-partial';
                await service.msaveItem([
                    {
                        id: testPartialId,
                        type: 'update-equiv-test',
                        name: 'Original',
                        count: 100,
                        extraField: 'will-be-lost',
                        keepMe: 'will-be-lost-too',
                    },
                ]);
                dataMap.set(testPartialId, { id: testPartialId } as MyModel);

                await service.mupdateItem([
                    {
                        id: testPartialId,
                        type: 'update-equiv-test',
                        name: 'Partial Update',
                        count: 999,
                        // extraField and keepMe NOT provided - will be deleted
                    },
                ]);

                const afterPartial = await service.readItem(testPartialId);
                expect2(() => afterPartial.name).toEqual('Partial Update');
                expect2(() => (afterPartial as any).count).toEqual(999);
                expect2(() => (afterPartial as any).extraField).toEqual(undefined);
                expect2(() => (afterPartial as any).keepMe).toEqual(undefined);
            }
        });

        afterAll(async () => {
            if (!PROFILE) return;

            // Cleanup the table
            await Promise.all([...dataMap.keys()].map(id => service.deleteItem(id)));
        });
    });
});
