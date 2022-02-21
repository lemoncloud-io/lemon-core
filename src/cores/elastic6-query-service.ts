/**
 * `elastic6-query-service.ts`
 * - common service to query with id via elastic6
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 * @date        2021-12-07 support SearchBody
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from '../engine/';
import {
    GeneralItem,
    Elastic6SimpleQueriable,
    QueryResult,
    SimpleSearchParam,
    AutocompleteSearchParam,
    SearchBody,
} from './core-types';
import { Elastic6Service, SearchType } from './elastic6-service';
import $hangul from './hangul-service';
const NS = $U.NS('ES6Q', 'green'); // NAMESPACE TO BE PRINTED.

/**
 * class: `Elastic6QueryService`
 * - support simple query like range search.
 */
export class Elastic6QueryService<T extends GeneralItem> implements Elastic6SimpleQueriable<T> {
    protected readonly service: Elastic6Service;

    /**
     * use query w/ the given search-service.
     * @param service the origin search-service to use.
     */
    public constructor(service: Elastic6Service) {
        const options = service.options;
        if (!options.indexName) throw new Error('.indexName is required');
        this.service = service;
    }

    /**
     * get options
     */
    protected get options() {
        return this.service.options;
    }

    /**
     * say hello of identity.
     */
    public hello = () => `elastic6-query-service:${this.options.indexName}`;

    /**
     * query all by id.
     *
     * @param id
     * @param limit
     * @param isDesc
     */
    public async queryAll(id: string, limit?: number, isDesc?: boolean): Promise<QueryResult<T>> {
        const { idName } = this.options;
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
        const { indexName } = this.options;
        _log(NS, `- searchSimple(${indexName})....`);
        _log(NS, `> param =`, $U.json(param));
        //! build query body.
        const body = this.buildQueryBody(param);
        //! search via client
        const res = await this.search(body);
        //! convert to query-result.
        return this.asQueryResult(body, res);
    }

    /**
     * search with raw query language.
     *
     * @param body SearchBody.
     * @returns results.
     */
    public async search(body: SearchBody, searchType?: SearchType) {
        if (!body) throw new Error('@body (SearchBody) is required');
        return this.service.searchRaw(body, searchType);
    }

    /**
     * convert result as `QueryResult`
     * @param body the query body requested
     * @param res the result
     * @returns QueryResult
     */
    public asQueryResult(body: SearchBody, res: any): QueryResult<T> {
        const size = $U.N(body?.size, 10);
        //! extract for result.
        const hits = res?.hits;
        if (typeof hits !== 'object') throw new Error(`.hits (object) is required - hists:${$U.json(hits)}`);
        const total = $U.N(typeof (hits.total as any)?.value === 'number' ? (hits.total as any)?.value : hits.total, 0); // since v7.x
        const last = hits?.hits.length === size ? hits.hits[size - 1]?.sort : undefined;
        const list: T[] = ((hits && hits.hits) || []).map((N: any) => {
            const id = N && N._id; // id of elastic-search
            const score = N && N._score; // search score.
            const source = N && N._source; // origin data
            //! save as internal
            source._id = source._id || id; // attach to internal-id
            source._score = score;
            // delete internal autocomplete data
            delete source[Elastic6Service.DECOMPOSED_FIELD];
            delete source[Elastic6Service.QWERTY_FIELD];
            return source as T;
        });

        const result: QueryResult<T> = { list, total, last };
        if (res?.aggregations) {
            const $aggregations = res.aggregations || {};
            result.aggregations = Object.keys($aggregations).reduce((aggrs, field) => {
                const {
                    doc_count_error_upper_bound: docCountError = 0,
                    sum_other_doc_count: docSkippedCount = 0,
                    buckets,
                } = res.aggregations[field];
                if (docCountError > 0) _err(NS, `> [WARN] aggregation: counts for each term are not accurate.`);
                if (docSkippedCount > 0)
                    _err(NS, '> [WARN] aggregation: too many unique terms in the result. some terms are skipped.');
                if (Array.isArray(buckets)) {
                    aggrs[field] = buckets.map((bucket: any) => {
                        return { key: bucket.key, count: bucket.doc_count };
                    });
                }
                return aggrs;
            }, {} as any);
        }

        return result;
    }

    /**
     * convert `AutocompleteSearchParam` to `SearchBody`
     * @param param AutocompleteSearchParam
     * @returns SearchBody
     */
    public asSearchBody(param: AutocompleteSearchParam) {
        const { autocompleteFields } = this.options;
        // validate parameters
        if (!param) throw new Error('@param (AutocompleteSearchParam) is required');
        if (!param.$query || !Object.keys(param.$query).length) throw new Error('.query is required');
        if (Object.keys(param.$query).length > 1) throw new Error('.query accepts only one property');

        const [field, query] = Object.entries(param.$query)[0];
        if (!field || !query) throw new Error(`.query is invalid`);
        if (!autocompleteFields.includes(field)) throw new Error(`.query has no autocomplete field`);

        // build query body
        const decomposedField = `${Elastic6Service.DECOMPOSED_FIELD}.${field}`;
        const qwertyField = `${Elastic6Service.QWERTY_FIELD}.${field}`;
        const body: SearchBody = {
            query: {
                bool: {
                    should: [
                        { match: { [decomposedField]: $hangul.asJamoSequence(query) } },
                        { match: { [qwertyField]: query } },
                    ],
                    minimum_should_match: 1,
                },
            },
        };
        if (param.$filter) {
            body.query.bool.filter = Object.entries(param.$filter).map(([field, filter]) => {
                return { term: { [field]: filter } };
            });
        }
        body.size = $U.N(param.$limit, 10);
        body.from = $U.N(param.$page, 0) * body.size;
        return { field, query, body };
    }

    /**
     * search item in Search-as-You-Type way
     * @param param AutocompleteSearchParam
     */
    public async searchAutocomplete(param: AutocompleteSearchParam) {
        const { field, query, body } = this.asSearchBody(param);
        const res = await this.service.searchRaw(body);
        const result = this.asQueryResult(body, res);

        // highlighting result manually
        let list = result.list;
        if (param.$highlight) {
            // prepare tag name to wrap highlighted text
            const tagName = typeof param.$highlight == 'string' ? param.$highlight : 'em';
            // create a regular expression which has optional whitespaces between each character
            // e.g. 'COVID-19' => /C *O *V *I *D *- *1 *9/i
            const regexp = new RegExp([...query.replace(/\s/g, '')].join(' *'), 'i');

            // try to match regular expression with items found
            list = result.list.map(
                (item: any): T => {
                    const target = `${item[field] || ''}`;
                    const match = target.match(regexp);
                    if (match) {
                        item._highlight =
                            target.slice(0, match.index) +
                            `<${tagName}>${match[0]}</${tagName}>` +
                            target.slice(match.index + match[0].length);
                    } else {
                        item._highlight = target;
                    }
                    return item;
                },
            );
        }

        //! finally, override list.
        return { ...result, list };
    }

    /**
     * build query parameter from search param.
     */
    public buildQueryBody = (param: SimpleSearchParam): SearchBody => {
        //! parameters.
        let $query = null;
        let $source: any = null;
        let $page = -1;
        let $limit = -1;
        let $A = ''; // Aggregation
        let $O = ''; // OrderBy
        let $H = ''; // Highlight

        //! build query.
        const queries = Object.keys(param).reduce((list: string[], key: string): string[] => {
            let val = param[key as keyof SimpleSearchParam];
            // ignore internal values.
            if (key.startsWith('_')) return list;

            // _log(NS, `>> param[${key}] = `, val);
            if (key === '$query') {
                $query = {
                    query: typeof val === 'object' ? val : typeof val === 'string' ? JSON.parse(val) : `${val || ''}`,
                };
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
                    list.push(`(${val})`);
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
                } else if (typeof val === 'string' && val.indexOf !== undefined) {
                    // string array set.
                    let vals: string[] = val.split(',') || [];
                    let $includes: string[] = [];
                    let $excludes: string[] = [];
                    vals.forEach(val => {
                        val = `${val || ''}`.trim();
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
                (Array.isArray(val) ? val : `${val}`.split(',') || []).forEach((val: any) => {
                    val = `${val || ''}`.trim();
                    if (!val) return;
                    if (val.startsWith('!')) {
                        list.push('NOT _exists_:' + val.substr(1));
                    } else {
                        list.push('_exists_:' + val);
                    }
                });
            } else {
                //! escape if there is ' ' except like '(a AND B)'
                const escape_val = (val: any): string | string[] => {
                    if (typeof val === 'string' && val === '') {
                        return '"' + val + '"';
                    } else if (val && typeof val === 'string') {
                        if (val.startsWith('(') && val.endsWith(')')) {
                            // nop
                        } else if (val.startsWith('"') && val.endsWith('"')) {
                            // must be string block
                            return val;
                        } else if (val.indexOf(',') > 0) {
                            // list of array.
                            return val.split(',').map(s => {
                                return (s || '').trim();
                            });
                        } else if (
                            // special chars
                            val.indexOf(' ') >= 0 ||
                            val.indexOf('\n') >= 0 ||
                            val.indexOf(':') >= 0 ||
                            val.indexOf('\\') >= 0 ||
                            val.indexOf('#') >= 0 ||
                            val.indexOf('^') >= 0
                        ) {
                            const str = val.replace(/([\"\'])/gi, '\\$1'); // replace '"' -> '\"'
                            return '"' + str + '"';
                        }
                    }
                    return val;
                };
                val = escape_val(val);

                //! add to query-list.
                if (key.startsWith('!')) {
                    if (val) {
                        if (Array.isArray(val)) {
                            const vals = val.map((_: any) => escape_val(_));
                            list.push(key.substr(1) + ':(NOT (' + vals.join(' OR ') + '))');
                        } else {
                            list.push(key.substr(1) + ':(NOT ' + val + ')');
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
                } else if (val === undefined) {
                    //! nop
                } else if (val && Array.isArray(val)) {
                    // list.push('(' + val.map(val => `${key}:${val}`).join(' OR ') + ')');
                    list.push(`${key}:` + '(' + val.map((val: any) => `${escape_val(val)}`).join(' OR ') + ')');
                } else {
                    list.push(`${key}:${val}`);
                }
            }
            return list;
        }, []);

        //! prepare returned body.
        const $body: SearchBody = $query
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
