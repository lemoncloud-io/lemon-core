/**
 * `cosmos-service.spec.js`
 * - unit test for `cosmos-service` w/ dummy data
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-08-16 initial version with `cosmosDB` package.
 *
 * @copyright (C) 2023 LemonCloud Co Ltd. - All Rights Reserved.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { GETERR, expect2 } from '../../common/test-helper';
import { CosmosService, CosmosOption } from './cosmos-service';
import { GeneralItem } from 'lemon-model';
import { CosmosQueryService, CosmosQueryFilter } from './cosmos-query-service';
import { loadDataYml } from '../../tools';

interface MyModel extends GeneralItem {
    ID: string;
}

export const instance = () => {
    const databaseName = 'TestDatabase';
    const tableName = 'TestContainer';
    const idName = 'ID';
    const options: CosmosOption = { databaseName, tableName, idName };
    const cosmos = new CosmosService<MyModel>(options);
    const cosmosQuery = new CosmosQueryService(options);
    return { cosmos, cosmosQuery, options };
};

interface AccountItem extends GeneralItem {
    ID: string;
    type: 'account';
    name: string;
    contact: string;
    bank: string;
    balance: number;
}

//! main test body.
jest.setTimeout(30000);
describe('CosmosQueryService', () => {
    const data: AccountItem[] = loadDataYml('dummy-cosmos-query-data.yml').data;
    const dataMap = new Map<string, AccountItem>();

    // Setup test
    beforeAll(async () => {
        const { cosmos } = instance();
        // Initialize data in table
        await Promise.all(
            data.map(async item => {
                await cosmos.saveItem(item.ID, item);
                dataMap.set(item.ID, item); // Store into map
            }),
        );
    });

    it('should pass basic query operations', async () => {
        const { cosmosQuery, options } = instance();
        expect2(cosmosQuery.hello()).toEqual(`cosmos-query-service:${options.tableName}`);

        const res = await cosmosQuery.scan();
        expect2(res.list).toBeDefined();
        expect2(res.total).toBeDefined();

        //* test of the limited paging operations
        const conditions: CosmosQueryFilter[] = [{ key: 'type', comparator: '=', value: 'bank_account' }];
        let remain = data.length;
        let result;

        do {
            result = await cosmosQuery.scan(5, result ? result.last : null, conditions);
            expect2(result.total).toBeDefined();
            expect2(result.total).toBeLessThanOrEqual(5);
            remain -= result.total;

            if (remain > 0) {
                expect2(result.last).toBeDefined();
            }
        } while (remain > 0);
    });

    //! cosmos query service.
    it('should pass scan w/ simple filter', async () => {
        const { cosmosQuery, options } = instance();

        let conditions: CosmosQueryFilter[];
        let expectedCount: number;

        // 은행이 KB국민(bank = KB국민)인 개수
        conditions = [
            { key: 'bank', comparator: '=', value: 'KB국민' },
            { key: 'type', comparator: '=', value: 'bank_account' },
        ];
        expectedCount = data.filter(item => item.bank === 'KB국민').length;
        expect2(await cosmosQuery.scan(-1, null, conditions), 'total').toEqual({ total: expectedCount });

        // 연락처가 없는(contact = null) 개수
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'contact', comparator: '=', value: null },
        ];
        expectedCount = data.filter(item => item.contact === null).length;
        expect2(await cosmosQuery.scan(-1, null, conditions), 'total').toEqual({ total: expectedCount });

        // 연락처가 있는(contact != null) 개수
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { not: { key: 'contact', comparator: '=', value: null } },
        ];
        expectedCount = data.filter(item => item.contact !== null).length;
        expect2(await cosmosQuery.scan(-1, null, conditions), 'total').toEqual({ total: expectedCount });

        // 위의 필터와 동일한 표현식
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'contact', comparator: '!=', value: null },
        ];
        expect2(await cosmosQuery.scan(-1, null, conditions), 'total').toEqual({ total: expectedCount });

        // 잔액이 100~300만원(balance BETWEEN 1000000 AND 3000000)인 개수
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'balance', from: 1000000, to: 3000000 },
        ];
        expectedCount = data.filter(item => item.balance >= 1000000 && item.balance <= 3000000).length;
        expect2(await cosmosQuery.scan(-1, null, conditions), 'total').toEqual({ total: expectedCount });

        // note 필드가 존재하는(attribute_exists(note)) 개수
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'note', exists: true },
        ];
        expectedCount = data.filter(item => 'note' in item).length;
        expect2(await cosmosQuery.scan(-1, null, conditions), 'total').toEqual({ total: expectedCount });

        // 성이 이씨인(begins_with(name, '이') 개수
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'name', operator: 'begins_with', value: '이' },
        ];
        expectedCount = data.filter(item => item.name.startsWith('이')).length;
        expect2(await cosmosQuery.scan(-1, null, conditions), 'total').toEqual({ total: expectedCount });
    });

    it('should pass scan w/ complex filter', async () => {
        const { cosmosQuery, options } = instance();

        let conditions: CosmosQueryFilter[];
        let expectedCount: number;

        // 성이 신씨이거나 정씨인 개수
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            {
                or: [
                    { key: 'name', operator: 'begins_with', value: '신' },
                    { key: 'name', operator: 'begins_with', value: '정' },
                ],
            },
        ];
        expectedCount = data.filter(item => item.name.startsWith('신') || item.name.startsWith('정')).length;
        expect2(await cosmosQuery.scan(-1, null, conditions), 'total').toEqual({ total: expectedCount });

        // 성이 김씨가 아니고 잔액이 100~300만원인(NOT begins_with(name, '김') AND balance BETWEEN 1000000 AND 3000000) 개수
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { not: { key: 'name', operator: 'begins_with', value: '김' } },
            { key: 'balance', from: 1000000, to: 3000000 },
        ];
        expectedCount = data.filter(
            item => !item.name.startsWith('김') && item.balance >= 1000000 && item.balance <= 3000000,
        ).length;
        expect2(await cosmosQuery.scan(-1, null, conditions), 'total').toEqual({ total: expectedCount });

        // 은행이 NH농협인 사람 중 연락처가 없거나 잔액이 50만원 이하인 개수
        conditions = [
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
        expect2(await cosmosQuery.scan(-1, null, conditions), 'total').toEqual({ total: expectedCount });
    });

    // Cleanup table
    afterAll(async () => {
        const { cosmos } = instance();
        await Promise.all([...dataMap.keys()].map(id => cosmos.deleteItem(id)));
    });
});
