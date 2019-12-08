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
import { $engine, $U, _log, _inf, _err } from '../../engine';
const NS = $U.NS('S3', 'blue');

import AWS from 'aws-sdk';
import { v4 } from 'uuid';
import { CoreServices } from '../core-services';

export interface TagSet {
    [key: string]: string;
}

export interface CoreS3Service extends CoreServices {
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
const region = (): string => $engine.environ('REGION', 'ap-northeast-2') as string;

/**
 * use `target` as value or environment value.
 * environ('abc') => string 'abc'
 * environ('ABC') => use `env.ABC`
 */
const environ = (target: string, defEnvName: string, defEnvValue: string) => {
    const isUpperStr = target && /^[A-Z][A-Z0-9_]+$/.test(target);
    defEnvName = isUpperStr ? target : defEnvName;
    const val = defEnvName ? ($engine.environ(defEnvName, defEnvValue) as string) : defEnvValue;
    target = isUpperStr ? '' : target;
    return `${target || val}`;
};

//! get aws client for S3
const instance = async () => {
    const _region = region();
    const config = { region: _region };
    return new AWS.S3(config); // SQS Instance. shared one???
};

//! main service instance.
export class AWSS3Service implements CoreS3Service {
    /**
     * environ name config.
     */
    public static ENV_S3_NAME = 'MY_S3_BUCKET';
    public static DEF_S3_BUCKET = 'lemon-hello-www';

    /**
     * get name of this
     */
    public name = () => `S3`;

    /**
     * hello
     */
    public hello = () => `aws-s3-service:${''}`;

    /**
     * get target endpoint by name.
     */
    public bucket = async (target?: string) => {
        return environ(target, AWSS3Service.ENV_S3_NAME, AWSS3Service.DEF_S3_BUCKET);
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
}
