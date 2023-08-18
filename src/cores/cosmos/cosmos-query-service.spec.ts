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
import { loadProfile } from '../../environ';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { GETERR, expect2 } from '../../common/test-helper';
import { CosmosService, CosmosOption } from './cosmos-service';
import { GeneralItem } from 'lemon-model';
import { CosmosQueryService } from './cosmos-query-service';
import { loadDataYml } from '../../tools';

interface MyModel extends GeneralItem {
    ID: string;
}

export const instance = () => {
    const tableName = 'TestTable';
    const idName = 'ID';
    const sortName = 0 ? 'ID' : undefined;
    const options: CosmosOption = { tableName, idName, sortName };
    const cosmos = new CosmosService<MyModel>(options);
    const queryService = new CosmosQueryService(options);
    return { cosmos, queryService, options };
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
describe('CosmosQueryService', () => {
    const data: AccountItem[] = loadDataYml('dummy-cosmos-query-data.yml').data;
    const dataMap = new Map<string, AccountItem>();

    const PROFILE = loadProfile(); // use `env/<ENV>.yml`
    
    // Setup test
    beforeAll(async () => {
        const { cosmos } = instance();
        if (!PROFILE) return;
        // Initialize data in table
        await Promise.all(
            data.map(async item => {
                await cosmos.saveItem(item.ID, item);
                dataMap.set(item.ID, item); // Store into map
            }),
        );
    });

    //! cosmos query service.
    it('should pass basic query operations', async () => {
        const { queryService, options } = instance();

        expect2(queryService.hello()).toEqual(`cosmos-query-service:${options.tableName}`);
        
        if (!PROFILE) return;
        let conditions
        let expectedCount
        
        // 은행이 KB국민(bank = KB국민)인 개수
        conditions = [
            { key: 'bank', comparator: '=', value: 'KB국민' },
            { key: 'type', comparator: '=', value: 'bank_account' },
        ];
        expectedCount = data.filter(item => item.bank === 'KB국민').length;
        expect2((await queryService.readItemsByConditions(conditions)).count).toMatchObject({ count: expectedCount });


        // 연락처가 없는(contact = null) 개수
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'contact', comparator: '=', value: null },
        ];
        expectedCount = data.filter(item => item.contact === null).length;
        expect2((await queryService.readItemsByConditions(conditions)).count).toMatchObject({ count: expectedCount });
        

        // 연락처가 있는(contact != null) 개수
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { not: { key: 'contact', comparator: '=', value: null } },
        ];
        expectedCount = data.filter(item => item.contact !== null).length;
        expect2((await queryService.readItemsByConditions(conditions)).count).toMatchObject({ count: expectedCount });
        

        // 위의 필터와 동일한 표현식
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'contact', comparator: '!=', value: null }, 
        ];
        expect2((await queryService.readItemsByConditions(conditions)).count).toMatchObject({ count: expectedCount });
        

        // 잔액이 100~300만원(balance BETWEEN 1000000 AND 3000000)인 개수
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'balance', from: 1000000, to: 3000000 },
        ];
        expectedCount = data.filter(item => item.balance >= 1000000 && item.balance <= 3000000).length
        expect2((await queryService.readItemsByConditions(conditions)).count).toMatchObject({ count: expectedCount });


        // note 필드가 존재하는(attribute_exists(note)) 개수
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'note', exists: true },
        ];
        expectedCount = data.filter(item => 'note' in item).length;
        expect2((await queryService.readItemsByConditions(conditions)).count).toMatchObject({ count: expectedCount });


        // 성이 이씨인(begins_with(name, '이') 개수
        conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { key: 'name', operator: 'begins_with', value: '이' },
        ];
        expectedCount = data.filter(item => item.name.startsWith('이')).length;
        expect2((await queryService.readItemsByConditions(conditions)).count).toMatchObject({ count: expectedCount });
    });


    it('should pass scan w/ complex filter', async () => {
        const { queryService, options } = instance();
        
        if (!PROFILE) return;
        let conditions
        let expectedCount

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
        expect2((await queryService.readItemsByConditions(conditions)).count).toMatchObject({ count: expectedCount });


         // 성이 김씨가 아니고 잔액이 100~300만원인(NOT begins_with(name, '김') AND balance BETWEEN 1000000 AND 3000000) 개수
         conditions = [
            { key: 'type', comparator: '=', value: 'bank_account' },
            { not: { key: 'name', operator: 'begins_with', value: '김' } },
            { key: 'balance', from: 1000000, to: 3000000 },
        ];
        expectedCount = data.filter(
            item => !item.name.startsWith('김') && item.balance >= 1000000 && item.balance <= 3000000,
        ).length;
        expect2((await queryService.readItemsByConditions(conditions)).count).toMatchObject({ count: expectedCount });


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
        expect2((await queryService.readItemsByConditions(conditions)).count).toMatchObject({ count: expectedCount });
        
    });

    // Cleanup table
    afterAll(async () => {
        const { cosmos } = instance();
        await Promise.all([...dataMap.keys()].map(id => cosmos.deleteItem(id)));
    });
    
});
