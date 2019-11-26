/**
 * `elastic6-query-service.ts`
 * - common service to query with id via elastic6
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U, $_ } from '../engine/';
const NS = $U.NS('ES6Q', 'green'); // NAMESPACE TO BE PRINTED.

import { GeneralItem } from './core-types';
import { Elastic6Option, instance, $ERROR } from './elastic6-service';
import { SearchParams } from 'elasticsearch';

/**
 * class: QueryResult
 * - result information of query.
 */
export interface QueryResult<T> {
    // list of data
    list: T[];
    // number of data
    total?: number;
}
/**
 * class: `SimpleSearchParam`
 * - simplified search param with json object.
 */
export interface SimpleSearchParam extends GeneralItem {
    $query?: string | any; // low query object.
    $limit?: number; // limit
    $page?: number; // page
    $Q?: string; // simple inline query
    $A?: string; // aggregation.
    $O?: string; // ordering.
    $H?: string; // highlight.
    $source?: string; // returned source fields set. '*', 'obj.*', '!abc'
    $exist?: string; // check if exists
    $exists?: string; // check if exists
}

/**
 * feature: `DynamoSimpleQueriable`
 * - simple query capable class.
 */
export interface Elastic6SimpleQueriable<T extends GeneralItem> {
    /**
     * simple range query by `partition-key` w/ limit.
     *
     * @param id        value of id
     */
    queryAll(id: string, limit?: number, isDesc?: boolean): Promise<QueryResult<T>>;

    /**
     * search in simplemode
     *
     * @param param     SimpleSearchParam
     */
    searchSimple(param: SimpleSearchParam): Promise<QueryResult<T>>;
}

/** ****************************************************************************************************************
 *  Service Main
 ** ****************************************************************************************************************/
/**
 * class: `Elastic6QueryService`
 * - support simple query like range search.
 */
export class Elastic6QueryService<T extends GeneralItem> implements Elastic6SimpleQueriable<T> {
    protected options: Elastic6Option;
    public constructor(options: Elastic6Option) {
        // eslint-disable-next-line prettier/prettier
        _inf(NS, `Elastic6QueryService(${options.indexName}/${options.idName})...`);
        if (!options.indexName) throw new Error('.indexName is required');
        this.options = { ...options };
    }

    /**
     * query all by id.
     *
     * @param id
     * @param limit
     * @param isDesc
     */
    public async queryAll(id: string, limit?: number, isDesc?: boolean): Promise<QueryResult<T>> {
        const { endpoint, indexName, idName } = this.options;
        const param: any = {
            [idName]: id,
        };
        if (limit !== undefined) param['$limit'] = limit;
        if (isDesc !== undefined) param['$O'] = (isDesc ? '!' : '') + id;
        return this.searchSimple(param);
    }

    /**
     * search in simple mode
     *  - 기본적으로 'mini-language'를 그대로 지원하도록한다.
     *  - 입력의 파라마터의 키값은 테스트할 필드들이다.
     *  {"stock":">1"} => query_string : "stock:>1"
     *
     *  - 파라미터 예약:
     *      $query : ES _search 용 쿼리를 그대로 이용.
     *      $exist : 'a,!b,c' => a AND NOT b AND c 를 _exists_ 항목으로 풀어씀.
     *      $source : _source 항목에 포함될 내용. (undefined => _source:false)
     *      $limit : same as "size"
     *      $page : same as "from" / "size"  ($limit 를 ipp 으로 함축하여 이용).
     *
     *
     *
     *  [Mini-Language]
     *  ```
     *  # find title field which contains quick or brown.
     *  title:(quick OR brown)
     *
     *  # not-null value.
     *  _exists_:title
     *
     *  # regular exp.
     *  name:/joh?n(ath[oa]n)/
     * ```
     *
     *
     * 참고: https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-query-string-query.html#query-string-syntax
     * 참고: http://okfnlabs.org/blog/2013/07/01/elasticsearch-query-tutorial.html
     *
     * @param param     search param
     */
    public async searchSimple(param: SimpleSearchParam) {
        if (!param) throw new Error('@param (SimpleSearchParam) is required');
        const { endpoint, indexName } = this.options;
        const { client } = instance(endpoint);
        _log(NS, `- search(${indexName})....`);
        _log(NS, `> param =`, $U.json(param));

        //! build query body.
        const payload = this.buildQueryBody(param);

        const id = '';
        const type = 1 ? '_doc' : '';
        const params: SearchParams = { index: indexName, type, body: payload };
        _log(NS, `> params[${id}] =`, $U.json(params));
        const res = await client.search(params).catch(
            $ERROR.handler('search', e => {
                _err(NS, `> search[${indexName}].err =`, e);
                throw e;
            }),
        );
        // {"took":6,"timed_out":false,"_shards":{"total":4,"successful":4,"skipped":0,"failed":0},"hits":{"total":1,"max_score":0.2876821,"hits":[{"_index":"test-v3","_type":"_doc","_id":"aaa","_score":0.2876821,"_source":{"name":"AAA","@id":"aaa","a":-3,"b":-2}}]}}
        _log(NS, `> search[${id}].res =`, $U.json(res));
        _log(NS, `> search[${id}].took =`, res.took);
        _log(NS, `> search[${id}].hits.total =`, res.hits && res.hits.total);
        _log(NS, `> search[${id}].hits.max_score =`, res.hits && res.hits.max_score);
        _log(NS, `> search[${id}].hits.hits[0] =`, res.hits && res.hits.hits[0]);

        //! extract for result.
        const $hits = res.hits;
        const hits = ($hits && $hits.hits) || [];
        const total = $U.N($hits && $hits.total, 0);
        const list: T[] = hits.map((_: any) => {
            const id = _ && _._id; // id of elastic-search
            const score = _ && _._score; // search score.
            const source = _ && _._source; // origin data
            source._id = source._id || id; // attach to internal-id
            return source as T;
        });

        const result: QueryResult<T> = { list, total };
        return result;
    }

    /**
     * build query parameter from search param.
     */
    public buildQueryBody = (param: SimpleSearchParam) => {
        //! parameters.
        let $query = null;
        let $source: any = null;
        let $page = -1;
        let $limit = -1;
        let $A = ''; // Aggregation
        let $O = ''; // OrderBy
        let $H = ''; // Highlight

        //! build query.
        const queries = $_.reduce(
            param,
            (list: any[], val: any, key: string) => {
                // ignore internal values.
                if (key.startsWith('_')) return list;

                // _log(NS, `>> param[${key}] = `, val);
                if (key === '$query') {
                    $query = { query: typeof val === 'object' ? val : JSON.parse(val) };
                } else if (key === '$limit') {
                    $limit = $U.N(val, 0);
                } else if (key === '$page') {
                    $page = $U.N(val, 0);
                } else if (key === '$Q') {
                    if (!val) {
                        //NOP;
                    } else if (typeof val === 'object') {
                        // ONLY IF object. use it as raw query.
                        $query = val;
                    } else if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
                        // might be the json data.
                        $query = JSON.parse(val);
                    } else if (typeof val === 'string') {
                        // might be query string.
                        //! escape queries..
                        // + - = && || > < ! ( ) { } [ ] ^ " ~ * ? : \ /
                        // val = val.replace(/([\(\)])/ig,'\\$1');	    //TODO - 이걸 무시하면, 중복 조건 검색에 문제가 생김, 하여 일단 안하는걸루. @180828.
                        list.push('(' + val + ')');
                    }
                } else if (key === '$A') {
                    $A = `${val}`.trim(); // ',' delimited terms to count
                } else if (key === '$O') {
                    $O = `${val}`.trim(); // ',' delimited terms to order
                } else if (key === '$H') {
                    $H = `${val}`.trim(); // ',' delimited terms to highlight
                } else if (key === '$source') {
                    // returned source fields set. '*', 'obj.*', '!abc'
                    if (val === '*') {
                        // all.
                        $source = '*';
                    } else if (val && val.indexOf && val.indexOf(',')) {
                        // string array set.
                        let vals: string[] = val.split(',') || [];
                        let $includes: string[] = [];
                        let $excludes: string[] = [];
                        vals.forEach(val => {
                            val = (val || '').trim();
                            if (!val) return;
                            if (val.startsWith('!')) {
                                $excludes.push(val.substr(1));
                            } else {
                                $includes.push(val);
                            }
                        });
                        $source = { includes: $includes, excludes: $excludes };
                    } else {
                        $source = val;
                    }
                } else if (key === '$exist' || key === '$exists') {
                    let vals: string[] = val.split(',') || [];
                    vals.forEach(val => {
                        val = (val || '').trim();
                        if (!val) return;
                        if (val.startsWith('!')) {
                            list.push('NOT _exists_:' + val.substr(1));
                        } else {
                            list.push('_exists_:' + val);
                        }
                    });
                } else {
                    //! escape if there is ' ' except like '(a AND B)'
                    if (val && typeof val === 'string') {
                        if (val.startsWith('(') && val.endsWith(')')) {
                            // nop
                        } else if (
                            val.indexOf(' ') > 0 ||
                            val.indexOf('\n') > 0 ||
                            val.indexOf(':') > 0 ||
                            val.indexOf('^') > 0
                        ) {
                            val = val.replace(/([\"\'])/gi, '\\$1');
                            val = '"' + val + '"';
                        } else if (val.indexOf(',') > 0) {
                            val = val.split(',').map(s => {
                                return (s || '').trim();
                            });
                        }
                    }
                    //! add to query-list.
                    if (key.startsWith('!')) {
                        if (val) {
                            if (Array.isArray(val)) {
                                val.forEach(_ => {
                                    _ && list.push('NOT ' + key.substr(1) + ':' + _);
                                });
                            } else {
                                list.push('NOT ' + key.substr(1) + ':' + val);
                            }
                        } else {
                            list.push('_exists_:' + key.substr(1));
                        }
                    } else if (key.startsWith('#')) {
                        // projection.
                        $source = $source || { includes: [], excludes: [] };
                        if ($source && $source.includes) {
                            $source.includes.push(key.substr(1));
                        }
                    } else {
                        if (Array.isArray(val)) {
                            list.push(
                                '(' +
                                    val
                                        .map(_ => {
                                            return key + ':' + _;
                                        })
                                        .join(' OR ') +
                                    ')',
                            );
                        } else {
                            list.push(key + ':' + val);
                        }
                    }
                }
                return list;
            },
            [],
        );

        //! prepare returned body.
        const $body: any = $query
            ? $query
            : (queries.length && { query: { query_string: { query: queries.join(' AND ') } } }) || {}; // $query 이게 있으면 그냥 이걸 이용.

        //! Aggregation.
        if ($A) {
            // const $aggs = {
            // 	// "types_count" : { "value_count" : { "field" : "brand" } }
            // 	"types_count" : { "terms" : { "field" : "brand" } }
            // }
            const $aggs = $A.split(',').reduce(($a: any, val: string) => {
                val = ('' + val).trim();
                if (val) {
                    if (val.indexOf(':') > 0) {
                        // must be size.
                        const [nm, size] = val.split(':', 2);
                        $a[nm] = { terms: { field: nm, size: parseInt(size) } };
                    } else {
                        $a[val] = { terms: { field: val } };
                    }
                }
                return $a;
            }, {});
            $body['aggs'] = $aggs;
        }

        //! OrderBy.
        if ($O) {
            //see sorting: see https://www.elastic.co/guide/en/elasticsearch/reference/current/search-request-sort.html.
            const $sort = $O.split(',').reduce(($a, val) => {
                val = ('' + val).trim();
                if (val) {
                    let name = val;
                    let asc = true;
                    if (val.startsWith('!')) {
                        // reverse
                        name = val.slice(1);
                        asc = false;
                    }
                    if (name) {
                        $a.push({ [name]: { order: asc ? 'asc' : 'desc' } });
                    }
                }
                return $a;
            }, []);

            if ($sort.length) {
                $body.sort = $sort;
            }
        }

        //! Highlight.
        if ($H) {
            const $highlight = $H.split(',').reduce(($h: any, val: string) => {
                val = ('' + val).trim();
                if (val) {
                    $h[val] = { type: 'unified' };
                }
                return $h;
            }, {});
            $body['highlight'] = {};
            $body['highlight']['fields'] = $highlight;
        }

        //! if valid limit, then paginating.
        if ($limit > -1) {
            $body.size = $limit;
            if ($page > -1) {
                // starts from 0
                $body.from = $page * $limit;
            }
        }

        //! field projection with _source parameter.
        if ($source !== null) $body._source = $source;

        //! returns body.
        return $body;
    };
}
