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
import { loadProfile } from '../../environ';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { GETERR, expect2 } from '../../common/test-helper';
import { DynamoService, DynamoOption } from './dynamo-service';
import { GeneralItem } from 'lemon-model';
import { DynamoQueryService } from './dynamo-query-service';
import { loadDataYml } from '../../tools';

interface MyModel extends GeneralItem {
    ID: string;
}

export const instance = () => {
    const tableName = 'DynamoTest';
    const idName = 'ID';
    const sortName = 0 ? 'ID' : undefined;
    const options: DynamoOption = { tableName, idName, sortName };
    const dynamo = new DynamoService<MyModel>(options);
    const dynamoQuery = new DynamoQueryService<MyModel>(options);
    return { dynamo, dynamoQuery, options };
};

//! main test body.
describe('DynamoQueryService', () => {
    const PROFILE = loadProfile(); // use `env/<ENV>.yml`
    const dataMap = new Map<string, MyModel>();

    beforeAll(async () => {
        const { dynamo } = instance();
        if (!PROFILE) return;

        // Initialize data in table
        const data: MyModel[] = loadDataYml('dummy-dynamo-query-data.yml').data;
        await Promise.all(
            data.map(async item => {
                const saved = await dynamo.saveItem(item.ID, item);
                dataMap.set(saved.ID, saved); // Store into map
            }),
        );
    });

    //! dynamo query service.
    it('should pass basic query operations', async () => {
        const { dynamoQuery, options } = instance();

        expect2(dynamoQuery.hello()).toEqual(`dynamo-query-service:${options.tableName}`);
        if (!PROFILE) return;

        //* check query builder
        expect2(() => dynamoQuery.buildQuery('00', -1, -1, undefined, null, undefined)).toEqual({
            ExpressionAttributeNames: { '#ID': 'ID' },
            ExpressionAttributeValues: { ':ID': '00' },
            KeyConditionExpression: '(#ID = :ID)',
            ScanIndexForward: true,
            TableName: 'DynamoTest',
        });

        //* check of none
        expect2(await dynamoQuery.queryAll('00').catch(GETERR), 'list,count').toEqual({ list: [], count: 0 });

        //* check by each item
        for (const [id, item] of dataMap.entries())
            expect2(await dynamoQuery.queryAll(id).catch(GETERR), 'list,count').toEqual({ list: [item], count: 1 });

        //* check by range
        for (const [id, item] of dataMap.entries())
            expect2(await dynamoQuery.queryRange(id, 0, 0, 1)).toEqual({ list: [item], count: 1, last: 0 });

        // TODO: Need to add sort key query test cases
    });

    afterAll(async () => {
        const { dynamo } = instance();
        if (!PROFILE) return;
        // Cleanup table
        await Promise.all([...dataMap.keys()].map(id => dynamo.deleteItem(id)));
    });
});
