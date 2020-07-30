/**
 * `elastic6-query-service.spec.ts`
 * - unit test for `elastic6-query-service`
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-07-29 initial version
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { loadProfile } from '../environ';
import { GETERR, expect2 } from '..';
import * as $elastic from './elastic6-service.spec';
import { Elastic6QueryService } from './elastic6-query-service';

const instance = () => {
    const { service: elastic, options } = $elastic.instance();
    const search: Elastic6QueryService<any> = new Elastic6QueryService(options);
    return { elastic, search, options };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('Elastic6QueryService', () => {
    const PROFILE = loadProfile(); // use `env/<ENV>.yml`
    jest.setTimeout(10000);

    // service identity
    it('should pass basic CRUD w/ dummy', async done => {
        const { elastic, search, options } = instance();
        /* eslint-disable prettier/prettier */
        expect2(() => elastic.hello()).toEqual('elastic6-service:test-v3');
        expect2(() => search.hello()).toEqual('elastic6-query-service:test-v3');
        expect2(() => options, 'idName,autocompleteFields').toEqual({ idName: 'id', autocompleteFields: ['title'] });
        /* eslint-enable prettier/prettier */
        done();
    });

    // search quality
    it('check search quality', async done => {
        const { elastic, search } = instance();
        /* eslint-disable prettier/prettier */

        // make sure the index is ready.
        const desc = await elastic.describe().catch(GETERR);
        if (typeof desc == 'string' && desc.startsWith('404 NOT FOUND')) {
            await elastic.createIndex().catch(() => {
                console.log('ERR!');
                // do nothing
            });
        }

        // prepare items
        expect2(await elastic.saveItem('1000001', { title: '선을 넘는 녀석들' }).catch(GETERR), '_id').toEqual({ _id: '1000001' });
        expect2(await elastic.saveItem('1000002', { title: '맛있는 녀석들' }).catch(GETERR), '_id').toEqual({ _id: '1000002' });
        expect2(await elastic.saveItem('1000003', { title: 'COVID-19' }).catch(GETERR), '_id').toEqual({ _id: '1000003' });
        expect2(await elastic.saveItem('1000004', { title: '똠얌꿍 끓이는 법' }).catch(GETERR), '_id').toEqual({ _id: '1000004' });
        expect2(await elastic.saveItem('1000005', { title: '화장품정리대' }).catch(GETERR), '_id').toEqual({ _id: '1000005' });
        await new Promise(resolve => {
            setTimeout(resolve, 1000); // require some time for indexing
        });

        // test normal search
        const normalSearch = async (query: string) => {
            const res = await search.searchSimple({ title: query });
            return (res.list && res.list.map(item => item.title)) || [];
        };
        expect2(await normalSearch('선')).toEqual(['선을 넘는 녀석들']);
        expect2(await normalSearch('을')).toEqual([]);
        expect2(await normalSearch('선을')).toEqual(['선을 넘는 녀석들']);
        expect2(await normalSearch('넘다')).toEqual(['선을 넘는 녀석들']);
        expect2(await normalSearch('넘어')).toEqual(['선을 넘는 녀석들']);
        expect2(await normalSearch('녀석')).toEqual(['선을 넘는 녀석들', '맛있는 녀석들']);
        expect2(await normalSearch('석')).toEqual([]);
        expect2(await normalSearch('석들')).toEqual([]);
        expect2(await normalSearch('녀석들')).toEqual(['선을 넘는 녀석들', '맛있는 녀석들']);
        expect2(await normalSearch('선넘는 녀석들')).toEqual(['선을 넘는 녀석들']);
        expect2(await normalSearch('똠')).toEqual([]);
        expect2(await normalSearch('똠얌')).toEqual(['똠얌꿍 끓이는 법']);
        expect2(await normalSearch('똠얌꿍')).toEqual(['똠얌꿍 끓이는 법']);
        expect2(await normalSearch('끓이기')).toEqual(['똠얌꿍 끓이는 법']);
        expect2(await normalSearch('cov')).toEqual([]);
        expect2(await normalSearch('covid')).toEqual(['COVID-19']);
        expect2(await normalSearch('covid-19')).toEqual(['COVID-19']);
        expect2(await normalSearch('covid19')).toEqual(['COVID-19']);
        expect2(await normalSearch('19')).toEqual(['COVID-19']);

        // test autocomplete search w/ highlighting
        const autocompleteSearch = async (query: string) => {
            const res = await search.searchAutocomplete({ $query: { title: query }, $highlight: true });
            return (res.list && res.list.map(item => ([item.title, item._highlight]))) || [];
        };
        expect2(await autocompleteSearch('ㅅ')).toEqual([['선을 넘는 녀석들', '선을 넘는 녀석들']]);
        expect2(await autocompleteSearch('서')).toEqual([['선을 넘는 녀석들', '선을 넘는 녀석들']]);
        expect2(await autocompleteSearch('선')).toEqual([['선을 넘는 녀석들', '<em>선</em>을 넘는 녀석들']]);
        expect2(await autocompleteSearch('선ㅇ')).toEqual([['선을 넘는 녀석들', '선을 넘는 녀석들']]);
        expect2(await autocompleteSearch('선으')).toEqual([['선을 넘는 녀석들', '선을 넘는 녀석들']]);
        expect2(await autocompleteSearch('넘느')).toEqual([['선을 넘는 녀석들', '선을 넘는 녀석들']]);
        expect2(await autocompleteSearch('선을 넘는')).toEqual([['선을 넘는 녀석들', '<em>선을 넘는</em> 녀석들']]);
        expect2(await autocompleteSearch('는녀')).toEqual([]);
        expect2(await autocompleteSearch('석들')).toEqual([]);
        expect2(await autocompleteSearch('녀서')).toEqual([['선을 넘는 녀석들', '선을 넘는 녀석들'], ['맛있는 녀석들', '맛있는 녀석들']]);
        expect2(await autocompleteSearch('녀석')).toEqual([['선을 넘는 녀석들', '선을 넘는 <em>녀석</em>들'], ['맛있는 녀석들', '맛있는 <em>녀석</em>들']]);
        expect2(await autocompleteSearch('ㄷ')).toEqual([]);
        expect2(await autocompleteSearch('ㄸ')).toEqual([['똠얌꿍 끓이는 법', '똠얌꿍 끓이는 법']]);
        expect2(await autocompleteSearch('또')).toEqual([['똠얌꿍 끓이는 법', '똠얌꿍 끓이는 법']]);
        expect2(await autocompleteSearch('똠')).toEqual([['똠얌꿍 끓이는 법', '<em>똠</em>얌꿍 끓이는 법']]);
        expect2(await autocompleteSearch('똠ㅇ')).toEqual([['똠얌꿍 끓이는 법', '똠얌꿍 끓이는 법']]);
        expect2(await autocompleteSearch('똠야')).toEqual([['똠얌꿍 끓이는 법', '똠얌꿍 끓이는 법']]);
        expect2(await autocompleteSearch('똠얌')).toEqual([['똠얌꿍 끓이는 법', '<em>똠얌</em>꿍 끓이는 법']]);
        expect2(await autocompleteSearch('똠얌꿍')).toEqual([['똠얌꿍 끓이는 법', '<em>똠얌꿍</em> 끓이는 법']]);
        expect2(await autocompleteSearch('똠얌꿍ㄲ')).toEqual([['똠얌꿍 끓이는 법', '똠얌꿍 끓이는 법']]);
        expect2(await autocompleteSearch('똠얌꿍끓')).toEqual([['똠얌꿍 끓이는 법', '<em>똠얌꿍 끓</em>이는 법']]);
        expect2(await autocompleteSearch('똠얌꿍 끓')).toEqual([['똠얌꿍 끓이는 법', '<em>똠얌꿍 끓</em>이는 법']]);
        expect2(await autocompleteSearch('똠얌꿍 버')).toEqual([['똠얌꿍 끓이는 법', '똠얌꿍 끓이는 법']]);
        expect2(await autocompleteSearch('c')).toEqual([['COVID-19', '<em>C</em>OVID-19']]);
        expect2(await autocompleteSearch('co')).toEqual([['COVID-19', '<em>CO</em>VID-19']]);
        expect2(await autocompleteSearch('covid')).toEqual([['COVID-19', '<em>COVID</em>-19']]);
        expect2(await autocompleteSearch('covid1')).toEqual([['COVID-19', 'COVID-19']]);
        expect2(await autocompleteSearch('covid19')).toEqual([['COVID-19', 'COVID-19']]);
        expect2(await autocompleteSearch('covid 1')).toEqual([['COVID-19', 'COVID-19']]);
        expect2(await autocompleteSearch('covid-1')).toEqual([['COVID-19', '<em>COVID-1</em>9']]);
        expect2(await autocompleteSearch('화자')).toEqual([['화장품정리대', '화장품정리대']]);
        expect2(await autocompleteSearch('화장ㅍ')).toEqual([['화장품정리대', '화장품정리대']]);
        expect2(await autocompleteSearch('정리')).toEqual([]);
        expect2(await autocompleteSearch('정리대')).toEqual([]);
        expect2(await autocompleteSearch('화장품정')).toEqual([['화장품정리대', '<em>화장품정</em>리대']]);

        // test autocomplete search - alphabet sequence by typing Korean
        const autocompleteSearch2 = async (query: string) => {
            const res = await search.searchAutocomplete({ $query: { title: query }, $highlight: false });
            return (res.list && res.list.map(item => item.title)) || [];
        };
        expect2(await autocompleteSearch2('t')).toEqual(['선을 넘는 녀석들']);
        expect2(await autocompleteSearch2('tjs')).toEqual(['선을 넘는 녀석들']);
        expect2(await autocompleteSearch2('tjsd')).toEqual(['선을 넘는 녀석들']);
        expect2(await autocompleteSearch2('tjsdm')).toEqual(['선을 넘는 녀석들']);
        expect2(await autocompleteSearch2('sjasm')).toEqual(['선을 넘는 녀석들']);
        expect2(await autocompleteSearch2('smssu')).toEqual([]);
        expect2(await autocompleteSearch2('tjremf')).toEqual([]);
        expect2(await autocompleteSearch2('sutj')).toEqual(['선을 넘는 녀석들', '맛있는 녀석들']);
        expect2(await autocompleteSearch2('sutjr')).toEqual(['선을 넘는 녀석들', '맛있는 녀석들']);
        expect2(await autocompleteSearch2('ehadi')).toEqual([]);
        expect2(await autocompleteSearch2('Ehadi')).toEqual(['똠얌꿍 끓이는 법']);

        /* eslint-enable prettier/prettier */
        done();
    });
});
