/**
 * `elastic6-query-service.spec.ts`
 * - unit test for `elastic6-query-service`
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-07-29 initial version
 * @date        2022-02-22 optimized w/ elastic client (elasticsearch-js)
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { loadProfile } from '../../environ';
import { GETERR, expect2, waited } from '../..';
import { Elastic6QueryService } from './elastic6-query-service';
import { canPerformTest, VERSIONS } from './elastic6-service.spec';
import * as $elastic from './elastic6-service.spec';

const instance = (version: VERSIONS, indexName: string) => {
    const { service: elastic, options } = $elastic.instance(version, true, indexName);
    const search: Elastic6QueryService<any> = new Elastic6QueryService(elastic);
    return { elastic, search, options, indexName };
};

export const runElastic6QueryServiceTests = async (instanceVersion: VERSIONS, instanceIndexName: string) => {
    const defaultVersion: VERSIONS = instanceVersion ?? (['6.2', '6.8', '7.1', '7.2', '0'][3] as VERSIONS);
    const defaultIndexName = instanceIndexName ?? 'test-v4';
    describe(`Elastic6QueryService ${defaultVersion}`, () => {
        const PROFILE = loadProfile(process); // override process.env.
        if (PROFILE) console.info(`! PROFILE =`, PROFILE);

        jest.setTimeout(120000);

        // service identity
        it(`should pass basic CRUD w/ dummy`, async () => {
            const { elastic, search, options } = instance(defaultVersion, defaultIndexName);
            /* eslint-disable prettier/prettier */

            const { version } = options;

            expect2(() => elastic.hello()).toEqual(`elastic6-service:${defaultIndexName}:${version}`);
            expect2(() => search.hello()).toEqual(`elastic6-query-service:${defaultIndexName}`);
            expect2(() => options, 'idName,autocompleteFields').toEqual({ idName: '$id', autocompleteFields: ['title', 'name'] });
            /* eslint-enable prettier/prettier */
        });

        // test buildQueryBody()
        it(`should pass buildQueryBody()`, async () => {
            const { search } = instance(defaultVersion, defaultIndexName);

            expect2(() => search.buildQueryBody({ _x: 0, a: 1 })).toEqual({
                query: { query_string: { query: 'a:1' } },
            });
            expect2(() => search.buildQueryBody({ '!a': 2, b: '3,4', c: '' })).toEqual({
                query: { query_string: { query: 'a:(NOT 2) AND b:(3 OR 4) AND c:""' } },
            });
        });

        // autocomplete search
        it(`should pass autocomplete search`, async () => {
            if (!PROFILE) return; // ignore w/o profile
            const { elastic, search, indexName } = instance(defaultVersion, `test-autocomplete-v${defaultVersion}`);

            //* break if no live connection
            if (!(await canPerformTest(elastic))) return;

            //* make sure if index is ready.
            const $old = await elastic.findIndex(indexName);
            if (!$old)
                expect2(await elastic.createIndex().catch(GETERR)).toEqual({ acknowledged: true, index: indexName });
            await waited(200);

            /* eslint-disable prettier/prettier */
            // prepare items
            expect2(await elastic.saveItem('AC001', {
                type: 'member', title: 'Senior Director', name: 'Marvin', id: 'AC001'}).catch(GETERR), '_id').toEqual({ _id: 'AC001' });
            expect2(await elastic.saveItem('AC002', { type: 'member', title: 'Senior Software Engineer', name: 'Vickie' , id: 'AC002'}).catch(GETERR), '_id').toEqual({ _id: 'AC002' });
            expect2(await elastic.saveItem('AC003', { type: 'member', title: 'Software Developer', name: 'Gabriel' , id: 'AC003'}).catch(GETERR), '_id').toEqual({ _id: 'AC003' });
            expect2(await elastic.saveItem('AC004', { type: 'member', title: 'Designer', name: 'Cindy' , id: 'AC004'}).catch(GETERR), '_id').toEqual({ _id: 'AC004' });
            expect2(await elastic.saveItem('AC005', { type: 'department', title: 'Account' , id: 'AC005'}).catch(GETERR), '_id').toEqual({ _id: 'AC005' });
            expect2(await elastic.saveItem('AC006', { type: 'department', title: 'Software Lab' , id: 'AC006'}).catch(GETERR), '_id').toEqual({ _id: 'AC006' });
            expect2(await elastic.saveItem('AC007', { type: 'department', title: 'Design Lab' , id: 'AC007'}).catch(GETERR), '_id').toEqual({ _id: 'AC007' });
            expect2(await elastic.refreshIndex().catch(GETERR), '!_shards').toEqual({});
            await waited(200);

            // check query
            expect2(await search.searchAutocomplete({ $query: { title: 'Sof' } }), 'total').toEqual({ total: 3 }); // Senior Software Engineer, Software Developer, Software Lab
            expect2(await search.searchAutocomplete({ $query: { title: 'de' } }), 'total').toEqual({ total: 3 }); // Software Developer, Designer, Design Lab
            expect2(await search.searchAutocomplete({ $query: { title: 'or' } }), 'total').toEqual({ total: 0 });
            expect2(await search.searchAutocomplete({ $query: { title: 'e' } }), 'total').toEqual({ total: 1 }); // Senior Software Engineer
            // check filter
            expect2(await search.searchAutocomplete({ $query: { title: 'Sof' }, $filter: { type: 'member' } }), 'total').toEqual({ total: 2 }); // Senior Software Engineer, Software Developer
            expect2(await search.searchAutocomplete({ $query: { title: 'de' }, $filter: { type: 'member' } }), 'total').toEqual({ total: 2 }); // Software Developer, Designer
            expect2(await search.searchAutocomplete({ $query: { title: 'de' }, $filter: { type: 'department' } }), 'total').toEqual({ total: 1 }); // Design Lab

            /* eslint-enable prettier/prettier */
        });

        // search quality
        it(`should pass check search quality`, async () => {
            if (!PROFILE) return; // ignore w/o profile
            const { elastic, search, indexName } = instance(defaultVersion, `test-quality-v${defaultVersion}`);

            //* break if no live connection
            if (!(await canPerformTest(elastic))) return;

            //* make sure if index is ready.
            const $old = await elastic.findIndex(indexName);
            if ($old) {
                expect2(await elastic.destroyIndex()).toEqual({ status: 200, acknowledged: true, index: indexName });
                await waited(200);
            }
            expect2(await elastic.createIndex().catch(GETERR)).toEqual({
                status: 200,
                acknowledged: true,
                index: indexName,
            });
            await waited(200);

            /* eslint-disable prettier/prettier */
            // prepare items
            expect2(await elastic.saveItem('1000001', { title: '선을 넘는 녀석들' , id: '1000001'}).catch(GETERR), '_id').toEqual({ _id: '1000001' });
            expect2(await elastic.saveItem('1000002', { title: '맛있는 녀석들' , id: '1000002'}).catch(GETERR), '_id').toEqual({ _id: '1000002' });
            expect2(await elastic.saveItem('1000003', { title: 'COVID-19' , id: '1000003'}).catch(GETERR), '_id').toEqual({ _id: '1000003' });
            expect2(await elastic.saveItem('1000004', { title: '똠얌꿍 끓이는 법' , id: '1000004'}).catch(GETERR), '_id').toEqual({ _id: '1000004' });
            expect2(await elastic.saveItem('1000005', { title: '화장품정리대', id: '1000005'}).catch(GETERR), '_id').toEqual({ _id: '1000005' });
            await new Promise(resolve => {
                setTimeout(resolve, 1000); // require some time for indexing
            });

            // test normal search
            const cmprStr = (a: string, b: string) => a > b ? 1 : a < b ? -1 : 0;
            const normalSearch = async (query: string) => {
                try {
                    const res = await search.searchSimple({ title: query });
                    return res?.list?.map(item => item.title).sort(cmprStr) || [];
                } catch(e){
                    return GETERR(e);
                }
            };
            expect2(await normalSearch('선')).toEqual(['선을 넘는 녀석들']);
            expect2(await normalSearch('을')).toEqual([]);
            expect2(await normalSearch('선을')).toEqual(['선을 넘는 녀석들']);
            expect2(await normalSearch('넘다')).toEqual(['선을 넘는 녀석들']);
            expect2(await normalSearch('넘어')).toEqual(['선을 넘는 녀석들']);
            expect2(await normalSearch('녀석')).toEqual(['맛있는 녀석들', '선을 넘는 녀석들']);
            expect2(await normalSearch('석')).toEqual([]);
            expect2(await normalSearch('석들')).toEqual([]);
            expect2(await normalSearch('녀석들')).toEqual(['맛있는 녀석들', '선을 넘는 녀석들']);
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
                try {
                    const res = await search.searchAutocomplete({ $query: { title: query }, $highlight: true });
                    return res?.list?.map(item => ([item.title, item._highlight])).sort((A, B) => cmprStr(A[0], B[0])) || [];
                } catch(e){
                    return GETERR(e);
                }
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
            expect2(await autocompleteSearch('녀서')).toEqual([['맛있는 녀석들', '맛있는 녀석들'], ['선을 넘는 녀석들', '선을 넘는 녀석들']]);
            expect2(await autocompleteSearch('녀석')).toEqual([['맛있는 녀석들', '맛있는 <em>녀석</em>들'], ['선을 넘는 녀석들', '선을 넘는 <em>녀석</em>들']]);
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
                try{
                    const res = await search.searchAutocomplete({ $query: { title: query }, $highlight: false });
                    return res?.list?.map(item => item.title).sort(cmprStr) || [];
                } catch(e){
                    return GETERR(e);
                }
            };
            expect2(await autocompleteSearch2('tjs')).toEqual(['선을 넘는 녀석들']);
            expect2(await autocompleteSearch2('tjsd')).toEqual(['선을 넘는 녀석들']);
            expect2(await autocompleteSearch2('tjsdm')).toEqual(['선을 넘는 녀석들']);
            expect2(await autocompleteSearch2('sjasm')).toEqual(['선을 넘는 녀석들']);
            expect2(await autocompleteSearch2('smssu')).toEqual([]);
            expect2(await autocompleteSearch2('tjremf')).toEqual([]);
            expect2(await autocompleteSearch2('sutj')).toEqual(['맛있는 녀석들', '선을 넘는 녀석들']);
            expect2(await autocompleteSearch2('sutjr')).toEqual(['맛있는 녀석들', '선을 넘는 녀석들']);
            expect2(await autocompleteSearch2('ehadi')).toEqual([]);
            expect2(await autocompleteSearch2('Ehadi')).toEqual(['똠얌꿍 끓이는 법']);

                /* eslint-enable prettier/prettier */
        });
    });
};
////////////////////////////////////////////////////////////////////////////////////////////////////////
//* main test body with real server

//* Elastic6QueryService tests
//* it should pass basic CRUD w/ real server (6.2)
runElastic6QueryServiceTests('6.2', 'test-v6.2');

//* it should pass basic CRUD w/ real server(7.1)
runElastic6QueryServiceTests('7.1', 'test-v7.1');

//* it should pass basic CRUD w/ real server(7.2)
runElastic6QueryServiceTests('7.2', 'test-v7.2');

//* it should pass basic CRUD w/ real server(7.10)
runElastic6QueryServiceTests('7.10', 'test-v7.10');

//* it should pass basic CRUD w/ open-search server(1.1)
runElastic6QueryServiceTests('1.1', 'test-v1.1');

//* it should pass basic CRUD w/ open-search server(1.2)
runElastic6QueryServiceTests('1.2', 'test-v1.2');

//* it should pass basic CRUD w/ open-search server(2.13)
runElastic6QueryServiceTests('2.13', 'test-v2.13');

////////////////////////////////////////////////////////////////////////////////////////////////////////
//* Unit tests with DummyElastic6Service
import { DummyElastic6Service } from './elastic6-service';

const dummyInstance = () => {
    const indexName = 'test-dummy';
    const options = {
        endpoint: 'http://localhost:9200',
        indexName,
        idName: '$id',
        version: '7.1',
        autocompleteFields: ['title', 'name'],
    };
    const elastic = new DummyElastic6Service('dummy-elastic6-data.yml', options);
    const search = new Elastic6QueryService(elastic);
    return { elastic, search, options, indexName };
};

describe('Elastic6QueryService - Unit Tests', () => {
    //* Test constructor
    it('should throw error when indexName is missing in service', () => {
        const elastic = new DummyElastic6Service('dummy-elastic6-data.yml', {
            endpoint: 'http://localhost:9200',
            indexName: 'test',
            idName: '$id',
        });
        elastic.options.indexName = ''; // Clear indexName after construction
        expect2(() => new Elastic6QueryService(elastic)).toEqual('.indexName is required');
    });

    //* Test hello()
    it('should return correct hello string', () => {
        const { search, indexName } = dummyInstance();
        expect2(search.hello()).toEqual(`elastic6-query-service:${indexName}`);
    });

    //* Test buildQueryBody with various parameters
    it('should build query body with single field', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: 'test' });

        expect2(result).toEqual({
            query: { query_string: { query: 'name:test' } },
        });
    });

    it('should build query body with multiple fields', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: 'test', age: '30' });

        expect2(result).toEqual({
            query: { query_string: { query: 'name:test AND age:30' } },
        });
    });

    it('should build query body with negation', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ '!status': 'deleted' });

        expect2(result).toEqual({
            query: { query_string: { query: 'status:(NOT deleted)' } },
        });
    });

    it('should build query body with OR condition', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ status: 'active,pending' });

        expect2(result).toEqual({
            query: { query_string: { query: 'status:(active OR pending)' } },
        });
    });

    it('should build query body with empty string', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: '' });

        expect2(result).toEqual({
            query: { query_string: { query: 'name:""' } },
        });
    });

    it('should build query body with limit', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: 'test', $limit: 5 });

        expect2(result.size).toEqual(5);
        expect2(result.query).toEqual({ query_string: { query: 'name:test' } });
    });

    it('should build query body with page and limit', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: 'test', $limit: 10, $page: 2 });

        expect2(result.size).toEqual(10);
        expect2(result.from).toEqual(20);
    });

    it('should build query body with $exists', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ $exists: 'email,!phone' });

        expect2(result).toEqual({
            query: { query_string: { query: '_exists_:email AND NOT _exists_:phone' } },
        });
    });

    it('should build query body with $source projection', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: 'test', $source: 'name,email' });

        expect2(result._source).toEqual({ includes: ['name', 'email'], excludes: [] });
    });

    it('should build query body with $source wildcard', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: 'test', $source: '*' });

        expect2(result._source).toEqual('*');
    });

    it('should build query body with $A aggregation', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: 'test', $A: 'category,brand:5' });

        expect2(result.aggs).toEqual({
            category: { terms: { field: 'category' } },
            brand: { terms: { field: 'brand', size: 5 } },
        });
    });

    it('should build query body with $O orderBy', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: 'test', $O: 'created,!updated' });

        expect2(result.sort).toEqual([{ created: { order: 'asc' } }, { updated: { order: 'desc' } }]);
    });

    it('should build query body with $H highlight', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: 'test', $H: 'title,content' });

        expect2(result.highlight).toEqual({
            fields: {
                title: { type: 'unified' },
                content: { type: 'unified' },
            },
        });
    });

    it('should build query body ignoring internal fields', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: 'test', _internal: 'value' });

        expect2(result).toEqual({
            query: { query_string: { query: 'name:test' } },
        });
    });

    it('should build query body with raw $query object', () => {
        const { search } = dummyInstance();
        const rawQuery = { match: { title: 'test' } };
        const result = search.buildQueryBody({ $query: rawQuery } as any);

        expect2(result).toEqual({
            query: rawQuery,
        });
    });

    it('should build query body with $Q string', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ $Q: 'title:test AND status:active' });

        expect2(result).toEqual({
            query: { query_string: { query: '(title:test AND status:active)' } },
        });
    });

    it('should build query body with $Q object', () => {
        const { search } = dummyInstance();
        const queryObj = { match: { title: 'test' } };
        const result = search.buildQueryBody({ $Q: queryObj } as any);

        expect2(result).toEqual(queryObj);
    });

    it('should build query body with $Q JSON string', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ $Q: '{"match":{"title":"test"}}' });

        expect2(result).toEqual({ match: { title: 'test' } });
    });

    it('should build query body with $source excludes', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: 'test', $source: 'title,!password,!secret' });

        expect2(result._source).toEqual({ includes: ['title'], excludes: ['password', 'secret'] });
    });

    it('should build query body with $source object', () => {
        const { search } = dummyInstance();
        const sourceObj = { includes: ['name'], excludes: ['id'] };
        const result = search.buildQueryBody({ name: 'test', $source: sourceObj } as any);

        expect2(result._source).toEqual(sourceObj);
    });

    it('should build query body with quoted string value', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ description: '"exact phrase"' });

        expect2(result).toEqual({
            query: { query_string: { query: 'description:"exact phrase"' } },
        });
    });

    it('should build query body with special characters', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ text: 'hello world: test' });

        expect2(result.query.query_string.query).toEqual('text:"hello world: test"');
    });

    it('should build query body with negation and array', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ '!category': 'a,b,c' });

        expect2(result).toEqual({
            query: { query_string: { query: 'category:(NOT (a OR b OR c))' } },
        });
    });

    it('should build query body with negation and null value', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ '!field': null });

        expect2(result).toEqual({
            query: { query_string: { query: '_exists_:field' } },
        });
    });

    it('should build query body with projection field', () => {
        const { search } = dummyInstance();
        const result = search.buildQueryBody({ name: 'test', '#title': true, '#email': true } as any);

        expect2(result._source).toEqual({ includes: ['title', 'email'], excludes: [] });
    });

    //* Test asSearchBody for autocomplete
    it('should throw error when param is missing', () => {
        const { search } = dummyInstance();

        expect2(() => search.asSearchBody(null as any)).toEqual('@param (AutocompleteSearchParam) is required');
    });

    it('should throw error when $query is missing', () => {
        const { search } = dummyInstance();

        expect2(() => search.asSearchBody({} as any)).toEqual('.query is required');
    });

    it('should throw error when $query has multiple properties', () => {
        const { search } = dummyInstance();

        expect2(() => search.asSearchBody({ $query: { title: 'test', name: 'test2' } })).toEqual(
            '.query accepts only one property',
        );
    });

    it('should throw error when field is not in autocompleteFields', () => {
        const { search } = dummyInstance();

        expect2(() => search.asSearchBody({ $query: { description: 'test' } })).toEqual(
            '.query has no autocomplete field',
        );
    });

    it('should build autocomplete search body', () => {
        const { search } = dummyInstance();
        const result = search.asSearchBody({ $query: { title: 'test' } });

        expect2(result.field).toEqual('title');
        expect2(result.query).toEqual('test');
        expect2(result.body.size).toEqual(10);
        expect2(result.body.from).toEqual(0);
    });

    it('should build autocomplete search body with filter', () => {
        const { search } = dummyInstance();
        const result = search.asSearchBody({ $query: { title: 'test' }, $filter: { type: 'article' } });

        expect2(result.body.query.bool.filter).toEqual([{ term: { type: 'article' } }]);
    });

    it('should build autocomplete search body with limit and page', () => {
        const { search } = dummyInstance();
        const result = search.asSearchBody({ $query: { title: 'test' }, $limit: 20, $page: 2 });

        expect2(result.body.size).toEqual(20);
        expect2(result.body.from).toEqual(40);
    });

    //* Test asQueryResult
    it('should convert search response to QueryResult', () => {
        const { search } = dummyInstance();
        const body = { size: 10 };
        const res = {
            hits: {
                total: 5,
                hits: [
                    { _id: '1', _score: 1.5, _source: { title: 'test1' } },
                    { _id: '2', _score: 1.2, _source: { title: 'test2' } },
                ],
            },
        };

        const result = search.asQueryResult(body, res);

        expect2(result.total).toEqual(5);
        expect2(result.list.length).toEqual(2);
        expect2(result.list[0]._id).toEqual('1');
        expect2(result.list[0]._score).toEqual(1.5);
    });

    it('should handle ES7+ total format', () => {
        const { search } = dummyInstance();
        const body = { size: 10 };
        const res = {
            hits: {
                total: { value: 100, relation: 'eq' },
                hits: [] as any[],
            },
        };

        const result = search.asQueryResult(body, res);

        expect2(result.total).toEqual(100);
    });

    it('should handle last pagination key', () => {
        const { search } = dummyInstance();
        const body = { size: 2 };
        const res = {
            hits: {
                total: 10,
                hits: [
                    { _id: '1', _score: 1.5, _source: { title: 'test1' }, sort: [100] },
                    { _id: '2', _score: 1.2, _source: { title: 'test2' }, sort: [200] },
                ],
            },
        };

        const result = search.asQueryResult(body, res);

        expect2(result.last).toEqual([200]);
    });

    it('should handle aggregations in result', () => {
        const { search } = dummyInstance();
        const body = { size: 10 };
        const res = {
            hits: { total: 0, hits: [] as any[] },
            aggregations: {
                category: {
                    buckets: [
                        { key: 'cat1', doc_count: 5 },
                        { key: 'cat2', doc_count: 3 },
                    ],
                },
            },
        };

        const result = search.asQueryResult(body, res);

        expect2(result.aggregations.category).toEqual([
            { key: 'cat1', count: 5 },
            { key: 'cat2', count: 3 },
        ]);
    });

    it('should handle aggregations with doc_count_error_upper_bound', () => {
        const { search } = dummyInstance();
        const body = { size: 10 };
        const res = {
            hits: { total: 0, hits: [] as any[] },
            aggregations: {
                category: {
                    doc_count_error_upper_bound: 5,
                    sum_other_doc_count: 0,
                    buckets: [{ key: 'cat1', doc_count: 10 }],
                },
            },
        };

        const result = search.asQueryResult(body, res);

        expect2(result.aggregations.category).toEqual([{ key: 'cat1', count: 10 }]);
    });

    it('should handle aggregations with sum_other_doc_count', () => {
        const { search } = dummyInstance();
        const body = { size: 10 };
        const res = {
            hits: { total: 0, hits: [] as any[] },
            aggregations: {
                category: {
                    doc_count_error_upper_bound: 0,
                    sum_other_doc_count: 100,
                    buckets: [{ key: 'cat1', doc_count: 10 }],
                },
            },
        };

        const result = search.asQueryResult(body, res);

        expect2(result.aggregations.category).toEqual([{ key: 'cat1', count: 10 }]);
    });

    it('should throw error when hits is not object', () => {
        const { search } = dummyInstance();
        const body = { size: 10 };
        const res = { hits: 'invalid' };

        expect2(() => search.asQueryResult(body, res)).toEqual('.hits (object) is required - hists:"invalid"');
    });

    //* Test searchAutocomplete with highlighting
    it('should search autocomplete with highlighting', async () => {
        const { elastic, search } = dummyInstance();

        const mockSearchRaw = jest.fn().mockResolvedValue({
            hits: {
                total: 1,
                hits: [{ _id: '1', _score: 1.0, _source: { title: 'COVID-19 test', $id: '1' } }],
            },
        });
        elastic.searchRaw = mockSearchRaw;

        const result = await search.searchAutocomplete({ $query: { title: 'covid' }, $highlight: true });

        expect2(result.list[0]._highlight).toEqual('<em>COVID</em>-19 test');
    });

    it('should search autocomplete with custom tag', async () => {
        const { elastic, search } = dummyInstance();

        const mockSearchRaw = jest.fn().mockResolvedValue({
            hits: {
                total: 1,
                hits: [{ _id: '1', _score: 1.0, _source: { title: 'test data', $id: '1' } }],
            },
        });
        elastic.searchRaw = mockSearchRaw;

        const result = await search.searchAutocomplete({ $query: { title: 'test' }, $highlight: 'mark' });

        expect2(result.list[0]._highlight).toEqual('<mark>test</mark> data');
    });

    it('should search autocomplete without match in highlighting', async () => {
        const { elastic, search } = dummyInstance();

        const mockSearchRaw = jest.fn().mockResolvedValue({
            hits: {
                total: 1,
                hits: [{ _id: '1', _score: 1.0, _source: { title: 'no match here', $id: '1' } }],
            },
        });
        elastic.searchRaw = mockSearchRaw;

        const result = await search.searchAutocomplete({ $query: { title: 'xyz' }, $highlight: true });

        expect2(result.list[0]._highlight).toEqual('no match here');
    });

    //* Test queryAll with dummy
    it('should query all items by id', async () => {
        const { elastic, search } = dummyInstance();

        // Mock searchRaw
        const mockSearchRaw = jest.fn().mockResolvedValue({
            hits: {
                total: 2,
                hits: [
                    { _id: 'A1', _score: 1.0, _source: { $id: 'A1', name: 'test1' } },
                    { _id: 'A2', _score: 0.9, _source: { $id: 'A2', name: 'test2' } },
                ],
            },
        });
        elastic.searchRaw = mockSearchRaw;

        const result = await search.queryAll('A');

        expect2(result.total).toEqual(2);
        expect2(result.list.length).toEqual(2);
    });

    //* Test searchSimple with error
    it('should throw error when param is missing in searchSimple', async () => {
        const { search } = dummyInstance();

        expect2(await search.searchSimple(null as any).catch(GETERR)).toEqual('@param (SimpleSearchParam) is required');
    });

    //* Test search with error
    it('should throw error when body is missing in search', async () => {
        const { search } = dummyInstance();

        expect2(await search.search(null as any).catch(GETERR)).toEqual('@body (SearchBody) is required');
    });
});
