/**
 * `s3s-service.js`
 * - common S3 services.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-07-19 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
/** ****************************************************************************************************************
 *  Common Headers
 ** ****************************************************************************************************************/
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, $U, _log, _inf, _err, doReportError } from '../../engine';
const NS = $U.NS('S3', 'blue');

import AWS from 'aws-sdk';
import * as StringTool from 'string_decoder';
import { CoreServices } from '../core-services';
import { DummyStorageService } from '../storage-service';

/**
 * S3를 NoSql을 대체해서 사용하기 위한 서비스
 */
export interface CoreS3Service extends CoreServices {
    name(): string;
    hello(): string;
    read(id: string): Promise<S3Model>;
    save(id: string, body: S3Model, meta?: Metadata, tags?: TagSet): Promise<S3Model>;
    delete(id: string): Promise<S3Model>;
    update(id: string, body: S3Model, meta?: Metadata, tags?: TagSet): Promise<S3Model>;
}

class S3CoreService {
    protected type: string;
    public constructor() {}

    public asKey = (id: string): string => {
        const prefix = id.match(/\//) !== null ? `${id}` : `${this.type || ''}/${id}`;
        const _id = id.match(/\.json/) !== null ? `${prefix}.json` : `${prefix}`;
        return _id;
    };
}

export interface S3Model {
    id?: string;
    type?: string;
    stereo?: string;
    syncId?: string;
}

export interface S3Params {
    Bucket: string;
    Key: string;
    Body?: string;
    ContentType?: string;
    Metadata?: Metadata;
}

export interface TagSet {
    [key: string]: string;
}

export interface Metadata {
    [key: string]: string;
}

/** ****************************************************************************************************************
 *  Public Instance Exported.
 ** ****************************************************************************************************************/
const region = (): string => $engine.environ('REGION', 'ap-northeast-2') as string;

//! get aws client for S3
const instance = async () => {
    const _region = region();
    const config = { region: _region };
    return new AWS.S3(config); // SQS Instance. shared one???
};

/**
 * JSON 타입 저장용 S3 Storage
 */
export class AWSS3Service extends S3CoreService implements CoreS3Service {
    /**
     * environ name config.
     */
    public static ENV_S3_NAME = 'MY_S3_BUCKET';
    public static DEF_S3_BUCKET = 'lemon-hello-www';
    protected bucket: string;
    protected type: string;
    protected idName: string;
    public constructor(type?: string, idName?: string) {
        super();
        this.bucket = $U.env(AWSS3Service.ENV_S3_NAME, AWSS3Service.DEF_S3_BUCKET);
        this.type = type || 'test';
        this.idName = idName || '_id';
    }

    /**
     * get name of this
     */
    public name = () => `S3`;

    /**
     * hello
     * @return {string} `target_service`:`which_bucket`:`this_type`
     */
    public hello = () => `aws-s3-service:${this.bucket}:${this.type}`;

    /**
     * upload a json file to S3 Bucket
     *
     * ```js
     * const res = $s3s.putObject(JSON.stringify({ message }), 'test.json', 'application/json');
     * // response would be like
     * {
     *  "Bucket": "lemon-hello-www",
     *  "ETag": "5e206.....8bd4c",
     *  "Key": "test.json",
     *  "Location": "https://lemon-hello-www.s3.ap-northeast-2.amazonaws.com/test.json",
     *  "key": "test.json"
     * }
     * ```
     *
     * @param {string} id
     * @param {object} body
     * @param {object} meta             (optional) meta to save.
     * @param {object} tags             (optional) tags to save.
     */
    public save = async (id: string, body: S3Model, meta?: Metadata, tags?: TagSet) => {
        _log(NS, `aws-s3-save:${this.bucket}(${id || ''})...`);
        if (!id) throw new Error('@id is required!');
        if (!body) throw new Error('@body is required!');
        if (!(typeof body == 'object')) throw new Error('@body must be Object');
        if (meta && !(typeof meta == 'object')) throw new Error('@meta must be Object');

        const Bucket = this.bucket || '';
        const _id = this.asKey(id);
        const Body = JSON.stringify({ ...body });
        const params: S3Params = { Bucket, Key: _id, Body, ContentType: 'application/json', Metadata: meta };
        const options = {
            tags: undefined as any,
        };
        _log(NS, `> S3.params = ${JSON.stringify(params)}`);
        options && _log(NS, `> S3.options = ${JSON.stringify(options)}`);

        if (tags && typeof tags == 'object') {
            options.tags = Object.keys(tags).reduce((L, key) => {
                const val = tags[key];
                L.push({ Key: key, Value: `${val}` });
                return L;
            }, []);
        }
        //! call s3.upload.
        return instance()
            .then(_ => _.upload(params, options).promise())
            .then(data => {
                const Key = (data && data.Key) || id;
                // const Location = (data && data.Location) || '';
                _log(NS, `> data[${Bucket}].Key =`, Key);
                return { ...body };
            })
            .catch(e => {
                doReportError(new Error(`S3:${this.bucket}:${_id} 500 SERVER`), null, null, e);
                throw new Error(`500 SERVER - ${JSON.stringify({ code: e.code, messag: e.message })}`);
            });
    };

    /**
     * return decoded Object from bucket file.
     * @param {string} id primary_id of Object
     */
    public read = async (id: string) => {
        _log(NS, `aws-s3-read:${this.bucket}(${id || ''})...`);
        if (!id) throw new Error('@id is required!');
        const Bucket = this.bucket || '';
        const _id = this.asKey(id);
        const params: S3Params = { Bucket, Key: _id };
        _log(NS, `> S3.params = ${JSON.stringify(params)}`);

        return instance()
            .then(_ => _.getObject(params).promise())
            .then((data: any) => {
                _log(NS, '> data.type =', typeof data);
                const decoder = new StringTool.StringDecoder('UTF8');
                const buf = Buffer.from(data.Body || data.Body.data || '');
                return JSON.parse(decoder.write(buf));
            })
            .catch(e => {
                if (e.code == 'NoSuchKey') throw new Error(`404 NOT FOUND - ${this.idName}:${this.type}/${id}.json`);
                else {
                    doReportError(new Error(`S3:${this.bucket}:${_id} 500 SERVER`), null, null, e);
                    throw new Error(`500 SERVER - ${JSON.stringify({ code: e.code, messag: e.message })}`);
                }
            });
    };

    protected async readSafe(id: string): Promise<S3Model> {
        return this.read(id).catch(e => {
            if (`${e.message || e}`.startsWith('404 NOT FOUND')) {
                // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
                const $org: S3Model = ({ [this.idName]: id } as unknown) as S3Model;
                return $org;
            }
            throw e;
        });
    }

    /**
     * delete object from S3
     * @param {string} id object id
     */
    public delete = async (id: string) => {
        _log(NS, `aws-s3-delete:${this.bucket}(${id || ''})...`);
        if (!id) throw new Error('@id is required!');
        const Bucket = this.bucket || '';
        const _id = this.asKey(id);
        const params: S3Params = { Bucket, Key: _id };
        _log(NS, `> S3.params = ${JSON.stringify(params)}`);

        const deleteObj = await instance()
            .then(_ => _.getObject(params).promise())
            .then((data: any) => {
                _log(NS, '> data.type =', typeof data);
                const decoder = new StringTool.StringDecoder('UTF8');
                const buf = Buffer.from(data.Body || data.Body.data || '');
                return JSON.parse(decoder.write(buf));
            })
            .catch(e => {
                if (e.code == 'NoSuchKey') throw new Error(`404 NOT FOUND - ${this.idName}:${this.type}/${id}.json`);
                else {
                    doReportError(new Error(`S3:${this.bucket}:${_id} 500 SERVER`), null, null, e);
                    throw new Error(`500 SERVER - ${JSON.stringify({ code: e.code, messag: e.message })}`);
                }
            });

        return instance()
            .then(_ => _.deleteObject(params).promise())
            .then(_ => {
                return { ...deleteObj };
            })
            .catch(e => {
                if (e.code == 'NoSuchKey') throw new Error(`404 NOT FOUND - ${this.idName}:${this.type}/${id}.json`);
                else {
                    doReportError(new Error(`S3:${this.bucket}:${_id} 500 SERVER`), null, null, e);
                    throw new Error(`500 SERVER - ${JSON.stringify({ code: e.code, messag: e.message })}`);
                }
            });
    };

    /**
     * update object from S3
     * @param {string} id
     * @param {object} body
     * @param {object} meta             (optional) meta to save.
     * @param {object} tags             (optional) tags to save.
     */
    public update = async (id: string, body: S3Model, meta?: Metadata, tags?: TagSet) => {
        _log(NS, `aws-s3-update:${this.bucket}(${id || ''})...`);
        if (!id) throw new Error('@id is required!');
        if (!body) throw new Error('@body is required!');
        if (!(typeof body == 'object')) throw new Error('@body must be Object');
        if (meta && !(typeof meta == 'object')) throw new Error('@meta must be Object');

        const Bucket = this.bucket || '';
        const _id = this.asKey(id);
        const params: S3Params = { Bucket, Key: _id };

        const selectObj = await this.readSafe(_id);
        params.Body = JSON.stringify({ ...selectObj, ...body });
        params.ContentType = 'application/json';
        params.Metadata = meta;

        const options = {
            tags: undefined as any,
        };

        if (tags && typeof tags == 'object') {
            options.tags = Object.keys(tags).reduce((L, key) => {
                const val = tags[key];
                L.push({ Key: key, Value: `${val}` });
                return L;
            }, []);
        }

        return instance()
            .then(_ => _.upload(params, options).promise())
            .then(data => {
                const Key = (data && data.Key) || id;
                _log(NS, `> data[${Bucket}].Key =`, Key);
                return { ...body };
            })
            .catch(e => {
                _err(NS, `! err[${Bucket}]=`, e);
                throw new Error(`500 SERVER - ${JSON.stringify({ code: e.code, messag: e.message })}`);
            });
    };
}

export class AWSS3DummyService<T extends S3Model> extends S3CoreService implements CoreS3Service {
    protected storage: DummyStorageService<T>;
    protected target: string;
    protected type: string;
    public constructor(target?: string, type?: string, idName?: string) {
        super();
        this.target = target;
        this.storage = new DummyStorageService<T>(target, type, `${idName || '_id'}`);
        this.type = type || 'dummy';
    }
    public name = () => `dummy`;
    public hello = () => this.storage.hello();
    public save = async (id: string, body: T, meta?: Metadata, tags?: TagSet): Promise<any> =>
        this.storage.save(`${this.type}/${id}.json`, body);
    public read = async (id: string): Promise<any> => this.storage.read(`${this.type}/${id}.json`);
    public delete = async (id: string): Promise<any> => this.storage.delete(`${this.type}/${id}.json`);
    public update = async (id: string, body: T, meta?: Metadata, tags?: TagSet): Promise<any> =>
        this.storage.update(`${this.type}/${id}.json`, body);
}
