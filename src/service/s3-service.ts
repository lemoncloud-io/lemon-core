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
import { $engine, $U, _log, _inf, _err } from '../core/engine';
import { EnginePluggable } from 'lemon-engine';
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
    putObject: (body: string, fileName?: string, contentType?: string, tags?: TagSet) => Promise<string>;
    getObject: (fileName: string) => Promise<any>;
}

/** ****************************************************************************************************************
 *  Public Instance Exported.
 ** ****************************************************************************************************************/
//TODO - load via environ.
const REGION = 'ap-northeast-2';

//! get aws client for S3
const instance = () => {
    const config = { region: REGION };
    return new AWS.S3(config); // SQS Instance. shared one???
};

//! main service instance.
export const S3 = new (class implements CoreS3Service {
    public ENV_NAME = 'REPORT_ERROR_ARN';
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
        target = target || 'lemon-hello-www';
        if (!target) throw new Error('@target is required!');
        const env = $engine.environ(target, '') as string;
        return `${env || target}`;
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
            .upload(params, options)
            .promise()
            .then(data => {
                const key = (data && data.Key) || fileName;
                _log(NS, '> data.key =', key);
                return key;
            });
    };

    /**
     * get a file from S3 Bucket
     *
     * @param {string} bucketId
     * @param {string} fileName
     */
    public getObject = async (fileName: string) => {
        if (!fileName) throw new Error('@fileName is required!');

        const Bucket = await this.bucket();
        const params = { Bucket, Key: fileName };

        //! call s3.getObject.
        // _log(NS, '> params =', params);
        return instance()
            .getObject(params)
            .promise();
    };

    /**
     * get next unique-id.
     */
    public nextId = () => {
        return v4();
    };
})();
