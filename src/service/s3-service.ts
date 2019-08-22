/**
 * `s3s-service.js`
 * - common S3 services.
 *
 *
 * @author  Steve <steve@lemoncloud.io>
 * @date    2019-07-19 initial version
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
/** ****************************************************************************************************************
 *  Common Headers
 ** ****************************************************************************************************************/
//! import core engine.
import { $U, _log, _inf, _err } from '../core/engine';
import { EnginePluggable } from 'lemon-engine';
import { environ, region } from './';
import AWS from 'aws-sdk';
import { v4 } from 'uuid';

//! module name & namepsace
const name = 'S3';
const NS = $U.NS(name, 'blue');

export interface TagSet {
    [key: string]: string;
}

export interface CoreS3Service extends EnginePluggable {
    hello: () => { hello: string };
    bucket: (target?: string) => Promise<string>;
    putObject: (
        body: string,
        fileName?: string,
        contentType?: string,
        tags?: TagSet,
    ) => Promise<{ Bucket: string; Key: string; Location: string }>;
    getObject: (fileName: string) => Promise<any>;
}

/** ****************************************************************************************************************
 *  Public Instance Exported.
 ** ****************************************************************************************************************/
//! get aws client for S3
const instance = async () => {
    const _region = await region();
    const config = { region: _region };
    return new AWS.S3(config); // SQS Instance. shared one???
};

//! main service instance.
export const S3 = new (class implements CoreS3Service {
    public ENV_NAME = 'CORE_S3_BUCKET';
    public DEF_BUCKET = 'lemon-hello-www';

    /**
     * get name of this
     */
    public name = () => `${name}`;

    /**
     * hello
     */
    public hello = () => ({ hello: 's3-service' });

    /**
     * get target endpoint by name.
     */
    public bucket = async (target?: string) => {
        // if (!target) throw new Error('@target is required!');
        return environ(target, this.ENV_NAME, this.DEF_BUCKET);
    };

    /**
     * upload a file to S3 Bucket
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
     * @param {string} bucketId
     * @param {string} fileName
     * @param {string} body
     * @param {object} tags             (optional) tags to save.
     */
    public putObject = async (body: string, fileName?: string, contentType?: string, tags?: TagSet) => {
        if (!body) throw new Error('@body is required!');
        _log(NS, `putObject(${fileName})...`);
        //! get unique file name.
        fileName = fileName || `${this.nextId()}.json`;
        contentType = contentType || 'application/json';

        const Bucket = await this.bucket();
        const params = { Bucket, Key: fileName, Body: body, ContentType: 'text/plain; charset=utf-8' };
        const options = {
            tags: undefined as any,
        };
        if (contentType) params.ContentType = contentType;
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
                const Key = (data && data.Key) || fileName;
                const Location = (data && data.Location) || '';
                _log(NS, `> data[${Bucket}].Key =`, Key);
                return { Bucket, Key, Location };
            })
            .catch(e => {
                _err(NS, `! err[${Bucket}]=`, e);
                throw e;
            });
    };

    /**
     * get a file from S3 Bucket
     *
     * @param {string} bucketId
     * @param {string} fileName
     */
    public getObject = async (fileName: string): Promise<any> => {
        if (!fileName) throw new Error('@fileName is required!');

        const Bucket = await this.bucket();
        const params = { Bucket, Key: fileName };

        //! call s3.getObject.
        // _log(NS, '> params =', params);
        return instance()
            .then(_ => _.getObject(params).promise())
            .then(data => {
                _log(NS, '> data.type =', typeof data);
                return data as any;
            })
            .catch(e => {
                _err(NS, '! err=', e);
                throw e;
            });
    };

    /**
     * get next unique-id.
     */
    public nextId = () => {
        return v4();
    };
})();
