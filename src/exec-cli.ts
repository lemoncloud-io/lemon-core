/**
 * `exec-cli.ts`
 * - command line runner w/ local http request.
 *
 *
 * ## run in command line.
 * ```bash
 * $ node . -ep goods -sid lemon -cmd sync-list -opt save=0 -page 1
 * ```
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-01 initial optimized via `imweb-forms-api/run.js`
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import request from 'request';

/** ********************************************************************************************************************
 *  boot loading for global instance manager
 ** *******************************************************************************************************************/
//! override envrionment.
const $env = { TS: '1', LC: '1' };
process.env = Object.assign(process.env, $env);

//! - load engine after `process.env`
import { $U, _log, _inf, _err } from './engine';
import { loadJsonSync, getRunParam } from './tools/';

//! - initial values.
const NS = $U.NS('EXEC', 'cyan');
const $pack = loadJsonSync('package.json');

const NAME = $pack.name || 'LEMON API';
const VERS = $pack.version || '0.0.0';
const PORT = $U.N($pack.port, 0); // default server port.
if (!PORT) throw new Error('.port is required at package.json!');
_log(NS, `###### exec[${NAME}@${$U.NS(VERS, 'cyan')}${PORT}] ######`);

/** ********************************************************************************************************************
 *  main application
 ** *******************************************************************************************************************/
//! do run http
const do_http = (options: any) => {
    if (!options || !options.uri) return Promise.reject(new Error('invalid options'));
    // const cookies = $cm.prepare(options.uri);
    options.headers = options.headers || {};
    // _log(NS, '! options =', options);
    //! preven error `body:null` if json.
    if (options.json && !options.body) {
        delete options.body;
    }
    // options.headers.Cookie = (options.headers.Cookie||'') + (options.headers.Cookie ? '; ':'') + cookies;
    return new Promise((resolve, reject) => {
        _inf(NS, options.method, options.uri);
        request(options, (error: any, res: any, body: any) => {
            if (error) {
                _err(NS, '!ERR=', error);
                return reject(error);
            }
            const ctype = res.headers['content-type'] || '';
            // _log(NS, '! content-type =', ctype);
            if (
                ctype.startsWith('application/json') &&
                typeof body == 'string' &&
                body.startsWith('{') &&
                body.endsWith('}')
            ) {
                try {
                    body = JSON.parse(body);
                    resolve(body);
                } catch (e) {
                    _err(NS, '! invalid json body =', body);
                    reject(e);
                }
            } else {
                // _log(NS, '! text body =', body);
                resolve(body);
            }
        });
    });
};

//! prepare request(json) options
const prepare_json = function(method: string, path: string, qs: any, body: any) {
    method = method || 'GET';
    if (!path) throw Error('path is required!');
    const options = {
        method,
        uri: path,
        json: true,
        qs,
        body,
    };
    // if (body) options.body = typeof body == 'object' ? JSON.stringify(body) : body;
    if (body) options.method = 'POST';
    body && _inf(NS, '> json.body =', JSON.stringify(body));
    return options;
};

//! wait some
const wait_sometime = (that: any, time: number) => {
    time = time || 1500;
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve(that);
        }, time);
    });
};

/** ********************************************************************************************************************
 *  main batch configuration.
 ** *******************************************************************************************************************/
/**
 * page로 하는, 배치 작업을 한번에 실행 시키기..
 *
 * ```sh
 * # example
 * $ node . -ep user -sid lemon -cmd test-self -opt 'force=1' -page 1 -max 2
 */
//! batch-run
const ENDPOINT = `http://localhost:${PORT}`;
const METHOD = getRunParam('m', 'GET') as string;
const EP = getRunParam('ep', '');
const ID = getRunParam('id', '0');
const IPP = getRunParam('ipp', 0) as number;
const WAIT = getRunParam('wait', 1000) as number;
const SID = getRunParam('sid', '');
const CMD = getRunParam('cmd', '');
const OPT = getRunParam('opt', '');
const [PAGE, MAX] = (() => {
    let page = getRunParam('page', '');
    let max = getRunParam('max', 1);
    if (`${page}`.indexOf('~') > 0) {
        const pages = `${page}`.split('~').map((_: string) => _.trim());
        page = parseInt(pages[0]) || 0;
        max = parseInt(pages[1]) || 0;
    } else {
        page = Number(page);
    }
    return [page, max];
})();
_log(NS, 'PAGE ~ MAX =', PAGE, '~', MAX);

//! execute page by page.
const run_batch = (that: any): Promise<any> => {
    //! invoke http(json).
    const my_chain_run_page = (that: any) => {
        const page = $U.N(that.page, -1);
        _inf(NS, '#page := ', page);
        if (page < 0) return Promise.reject(new Error('page is required!'));
        const body: any = {}; //{map: that.map, default: that.default, layout: that.layout};
        if (that.map) body.map = that.map;
        if (that.default) body.default = that.default;
        if (that.layout) body.layout = that.layout;
        const req = prepare_json(
            METHOD,
            `${ENDPOINT}/${EP}/${ID}/${CMD}?sid=${SID}` +
                (page ? '&page=' + page : '') +
                (IPP ? '&ipp=' + IPP : '') +
                (OPT ? '&' : '') +
                OPT,
            null,
            Object.keys(body).length ? body : null,
        );
        return do_http(req).then((_: any) => {
            _.layout && _log(NS, '! that[' + page + '].layout =', _.layout);
            _.range && _log(NS, '! that[' + page + '].range =', _.range);
            _.list && _log(NS, '! that[' + page + '].list =', _.list); // if has list.
            _.list || _inf(NS, '!WARN res =', _); // if not list.
            //! attach to that.
            if (_.map) that.map = _.map;
            if (_.default) that.default = _.default;
            if (_.layout) that.layout = _.layout;
            if (_.list) that.list = _.list;
            return that;
        });
    };

    return Promise.resolve(that)
        .then(my_chain_run_page)
        .then(_ => wait_sometime(_, WAIT))
        .then((that: any) => {
            const page = $U.N(that.page, 0);
            const list = that.list;
            const cnt = list ? list.length : -1; // '0' means EOF, -1 means N/A.
            const total = $U.N(that.total, 0);
            _inf(NS, '> cnt@page =', cnt + '@' + page, ':', total);
            const page2 = METHOD != 'DELETE' && page ? page + 1 : page;
            if (cnt === 0 || (MAX > 0 && page2 > MAX)) {
                _log(NS, 'FINISHED! Page =', page);
                return list;
            }
            that.page = page2;
            return run_batch(that);
        })
        .catch(e => {
            _err(NS, '!ERR! FIN=', e);
            throw e;
        });
};

//! export.
const run = () => {
    run_batch({ page: PAGE });
};

export default run;
