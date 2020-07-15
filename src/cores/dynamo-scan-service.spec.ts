/**
 * `dynamo-scan-service.spec.js`
 * - unit test for `dynamo-scan-service` w/ dummy data
 *
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-01-20 initial version
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2 } from '..';
import { loadProfile } from '../environ';
import { loadDataYml } from '../tools';
import { DynamoService, DynamoOption } from './dynamo-service';
import { DynamoScanFilter, DynamoScanService } from './dynamo-scan-service';
import { GeneralItem } from './core-types';

interface AccountItem extends GeneralItem {
    ID: string;
    type: 'account';
    name: string;
    contact: string;
    bank: string;
    balance: number;
}

export const instance = () => {
    const tableName = 'DynamoTest';
    const idName = 'ID';
    const options: DynamoOption = { tableName, idName };
    const dynamo = new DynamoService<AccountItem>(options);
    const dynamoScan = new DynamoScanService<AccountItem>(options);
    return { dynamo, dynamoScan, options };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('DynamoScanService', () => {
    const PROFILE = loadProfile(); // use `env/<ENV>.yml`
    const data: AccountItem[] = loadDataYml('dummy-dynamo-scan-data.yml').data;
    const dataMap = new Map<string, AccountItem>();

    // Setup test
    beforeAll(async done => {
        const { dynamo } = instance();
        if (PROFILE) {
            // Initialize data in table
            await data.map(async item => {
                const saved = await dynamo.saveItem(item.ID, item);
                dataMap.set(saved.ID, saved); // Store into map
            });
        }
        done();
    });

    // Teardown test
    afterAll(async done => {
        const { dynamo } = instance();
        if (PROFILE) {
            // Cleanup table
            await Promise.all([...dataMap.keys()].map(id => dynamo.deleteItem(id)));
        }
        done();
    });

    it('should pass basic scan operations', async done => {
        const { dynamoScan, options } = instance();
        expect2(dynamoScan.hello()).toEqual(`dynamo-scan-service:${options.tableName}`);
        if (PROFILE) {
            const res = await dynamoScan.scan();
            expect2(res.list).toBeDefined();
            expect2(res.count).toBeDefined();
        }
        done();
    });

    it('should pass limited scan operations', async done => {
        const { dynamoScan, options } = instance();
        if (PROFILE) {
            const filter: DynamoScanFilter = { key: 'type', comparator: '=', value: 'bank_account' };
            let remain = data.length;
            let res;

            do {
                res = await dynamoScan.scan(5, res ? res.last : null, filter);
                expect2(res.count).toBeDefined();
                expect2(res.count).toBeLessThanOrEqual(5);
                remain -= res.count;
                if (remain > 0) {
                    expect2(res.last).toBeDefined();
                    expect2(res.last[options.idName]).toBeDefined();
                }
            } while (remain > 0);
        }
        done();
    });

    it('should pass scan w/ simple filter', async done => {
        const { dynamoScan, options } = instance();
        if (PROFILE) {
            let filter: DynamoScanFilter;
            let expectedCount;

            // 은행이 KB국민(bank = KB국민)인 개수
            filter = [
                { key: 'type', comparator: '=', value: 'bank_account' },
                { key: 'bank', comparator: '=', value: 'KB국민' },
            ];
            expectedCount = data.filter(item => item.bank === 'KB국민').length;
            expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

            // 연락처가 없는(contact = null) 개수
            filter = [
                { key: 'type', comparator: '=', value: 'bank_account' },
                { key: 'contact', comparator: '=', value: null },
            ];
            expectedCount = data.filter(item => item.contact === null).length;
            expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

            // 연락처가 있는(contact != null) 개수
            filter = [
                { key: 'type', comparator: '=', value: 'bank_account' },
                { not: { key: 'contact', comparator: '=', value: null } },
            ];
            expectedCount = data.filter(item => item.contact !== null).length;
            expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });
            filter = [
                { key: 'type', comparator: '=', value: 'bank_account' },
                { key: 'contact', comparator: '!=', value: null }, // 위의 필터와 동일한 표현식
            ];
            expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

            // 잔액이 100~300만원(balance BETWEEN 1000000 AND 3000000)인 개수
            filter = [
                { key: 'type', comparator: '=', value: 'bank_account' },
                { key: 'balance', from: 1000000, to: 3000000 },
            ];
            expectedCount = data.filter(item => item.balance >= 1000000 && item.balance <= 3000000).length;
            expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

            // note 필드가 존재하는(attribute_exists(note)) 개수
            filter = [
                { key: 'type', comparator: '=', value: 'bank_account' },
                { key: 'note', exists: true },
            ];
            expectedCount = data.filter(item => 'note' in item).length;
            expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

            // 성이 이씨인(begins_with(name, '이') 개수
            filter = [
                { key: 'type', comparator: '=', value: 'bank_account' },
                { key: 'name', operator: 'begins_with', value: '이' },
            ];
            expectedCount = data.filter(item => item.name.startsWith('이')).length;
            expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });
        }
        done();
    });

    it('should pass scan w/ complex filter', async done => {
        const { dynamoScan, options } = instance();
        if (PROFILE) {
            let filter: DynamoScanFilter;
            let expectedCount;

            // 성이 신씨이거나 정씨인 개수
            filter = [
                { key: 'type', comparator: '=', value: 'bank_account' },
                {
                    or: [
                        { key: 'name', operator: 'begins_with', value: '신' },
                        { key: 'name', operator: 'begins_with', value: '정' },
                    ],
                },
            ];
            expectedCount = data.filter(item => item.name.startsWith('신') || item.name.startsWith('정')).length;
            expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

            // 성이 김씨가 아니고 잔액이 100~300만원인(NOT begins_with(name, '김') AND balance BETWEEN 1000000 AND 3000000) 개수
            filter = [
                { key: 'type', comparator: '=', value: 'bank_account' },
                { not: { key: 'name', operator: 'begins_with', value: '김' } },
                { key: 'balance', from: 1000000, to: 3000000 },
            ];
            expectedCount = data.filter(
                item => !item.name.startsWith('김') && item.balance >= 1000000 && item.balance <= 3000000,
            ).length;
            expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });

            // 은행이 NH농협인 사람 중 연락처가 없거나 잔액이 50만원 이하인 개수
            filter = [
                { key: 'type', comparator: '=', value: 'bank_account' },
                { key: 'bank', comparator: '=', value: 'NH농협' },
                {
                    or: [
                        { key: 'contact', comparator: '!=', value: null },
                        { key: 'balance', comparator: '<=', value: 500000 },
                    ],
                },
            ];
            expectedCount = data.filter(
                item => item.bank === 'NH농협' && (item.contact != null || item.balance <= 500000),
            ).length;
            expect2(await dynamoScan.scan(-1, null, filter)).toMatchObject({ count: expectedCount });
        }
        done();
    });
});
