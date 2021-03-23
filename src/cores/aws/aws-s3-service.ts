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

import path from 'path';
import AWS from 'aws-sdk';
import mime from 'mime-types';
import { v4 } from 'uuid';
import { CoreServices } from '../core-services';

/** ****************************************************************************************************************
 *  Core Types.
 ** ****************************************************************************************************************/
export type Metadata = AWS.S3.Metadata;

export interface TagSet {
    [key: string]: string;
}

export interface PutObjectResult {
    Location: string;
    ETag: string;
    Bucket: string;
    Key: string;
    ContentLength?: number;
    ContentType?: string;
    Metadata?: Metadata;
}

export interface CoreS3Service extends CoreServices {
    bucket: (target?: string) => string;
    putObject: (body: string, key?: string, metadata?: Metadata, tags?: TagSet) => Promise<PutObjectResult>;
    getObject: (key: string) => Promise<any>;
    getDecodedObject: (key: string) => Promise<any>;
    getObjectTagging: (key: string) => Promise<TagSet>;
    deleteObject: (key: string) => Promise<void>;
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
const instance = () => {
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
    public hello = () => `aws-s3-service:${this.bucket()}`;

    /**
     * get target endpoint by name.
     */
    public bucket = (target?: string): string => environ(target, AWSS3Service.ENV_S3_NAME, AWSS3Service.DEF_S3_BUCKET);

    /**
     * retrieve metadata without returning the object
     * @param {string} key
     * @return  metadata object / null if not exists
     */
    public headObject = async (key: string): Promise<any> => {
        if (!key) throw new Error('@key is required!');

        const Bucket = this.bucket();
        const params = { Bucket, Key: key };

        //! call s3.getObject.
        const s3 = instance();
        try {
            const data = await s3.headObject(params).promise();
            _log(NS, '> data =', $U.json(data));
            return data;
        } catch (e) {
            if (e.statusCode == 404) return null;
            _err(NS, '! err=', e);
            throw e;
        }
    };

    /**
     * upload a file to S3 Bucket
     *
     * ```js
     * const res = $s3.putObject(JSON.stringify({ message }), 'test.json');
     * // response would be like
     * {
     *  "Bucket": "lemon-hello-www",
     *  "ETag": "5e206.....8bd4c",
     *  "Key": "test.json",
     *  "Location": "https://lemon-hello-www.s3.ap-northeast-2.amazonaws.com/test.json",
     * }
     * ```
     *
     * @param {string|Buffer} content   content body
     * @param {string} key              (optional) S3 key to put
     * @param {Metadata} metadata       (optional) metadata to store
     * @param {object} tags             (optional) tag set
     */
    public putObject = async (
        content: string | Buffer,
        key?: string,
        metadata?: Metadata,
        tags?: TagSet,
    ): Promise<PutObjectResult> => {
        if (!content) throw new Error('@content is required!');

        const paramBuilder = new S3PutObjectRequestBuilder(this.bucket(), content);
        key && paramBuilder.setKey(key);
        metadata && paramBuilder.setMetadata(metadata);
        tags && paramBuilder.setTags(tags);

        const params = paramBuilder.asParams();
        _log(NS, `> params.ContentType =`, params.ContentType);
        _log(NS, `> params.ContentLength =`, params.ContentLength);
        _log(NS, `> params.Metadata =`, params.Metadata);
        _log(NS, `> params.Tagging =`, params.Tagging);

        // call s3.upload()
        const s3 = instance();
        try {
            const data = await s3.upload(params).promise();
            delete (data as any).key; // NOTE: remove undeclared property 'key' returned from aws-sdk
            _log(NS, `> data[${data.Bucket}].Location =`, $U.json(data.Location));

            return {
                ...data,
                ContentType: params.ContentType,
                ContentLength: params.ContentLength,
                Metadata: params.Metadata,
            };
        } catch (e) {
            _err(NS, `! err[${params.Bucket}] =`, e);
            throw e;
        }
    };

    /**
     * get a file from S3 Bucket
     *
     * @param {string} key
     */
    public getObject = async (key: string): Promise<any> => {
        if (!key) throw new Error('@key is required!');

        const Bucket = this.bucket();
        const params = { Bucket, Key: key };

        //! call s3.getObject.
        const s3 = instance();
        try {
            const data = await s3.getObject(params).promise();
            _log(NS, '> data.type =', typeof data);
            return data as any;
        } catch (e) {
            _err(NS, '! err=', e);
            throw e;
        }
    };

    /**
     * return decoded Object from bucket file.
     *
     * @param {string} key  ex) 'hello-0001.json' , 'dist/hello-0001.json
     */
    public getDecodedObject = async (key: string): Promise<any> => {
        if (!key) throw new Error('@key is required!');

        const Bucket = this.bucket();
        const params = { Bucket, Key: key };

        //! call s3.getObject.
        const s3 = instance();
        try {
            const data = await s3.getObject(params).promise();
            _log(NS, '> data.type =', typeof data);
            const content = data.Body.toString();
            return JSON.parse(content);
        } catch (e) {
            _err(NS, '! err=', e);
            throw e;
        }
    };

    /**
     * get tag-set of object
     * @param {string} key
     */
    public getObjectTagging = async (key: string): Promise<TagSet> => {
        const Bucket = this.bucket();
        const params = { Bucket, Key: key };

        //! call s3.getObject.
        const s3 = instance();
        try {
            const data = await s3.getObjectTagging(params).promise();
            _log(NS, `> data =`, data);
            return data.TagSet.reduce<TagSet>((tagSet, tag) => {
                const { Key, Value } = tag;
                tagSet[Key] = Value;
                return tagSet;
            }, {});
        } catch (e) {
            _err(NS, '! err=', e);
            throw e;
        }
    };

    /**
     * delete object from bucket
     * @param {string} key
     */
    public deleteObject = async (key: string): Promise<void> => {
        if (!key) throw new Error('@key is required!');

        const Bucket = this.bucket();
        const params = { Bucket, Key: key };

        //! call s3.deleteObject.
        const s3 = instance();
        try {
            const data = await s3.deleteObject(params).promise();
            _log(NS, '> data =', $U.json(data));
        } catch (e) {
            _err(NS, '! err=', e);
            throw e;
        }
    };
}

/**
 * class `S3PutObjectRequestBuilder`
 *  - util class to build S3.PutObjectRequest parameter
 */
class S3PutObjectRequestBuilder {
    // properties consisting S3.PutObjectRequest
    private readonly Body: Buffer;
    private readonly Bucket: AWS.S3.PutObjectRequest['Bucket'];
    private readonly ContentLength: AWS.S3.PutObjectRequest['ContentLength'];
    private ContentType?: AWS.S3.PutObjectRequest['ContentType'];
    private Key?: AWS.S3.PutObjectRequest['Key'];
    private Metadata: AWS.S3.PutObjectRequest['Metadata'];
    private Tagging?: AWS.S3.PutObjectRequest['Tagging'];

    /**
     * constructor
     */
    public constructor(bucket: string, content: string | Buffer) {
        const buffer = typeof content === 'string' ? Buffer.from(content) : content;

        this.Body = buffer;
        this.Bucket = bucket;
        this.ContentLength = buffer.length;
        this.Metadata = { md5: $U.md5(buffer, 'hex') };
    }

    /**
     * explicitly set key
     * @param key   S3 object key
     */
    public setKey(key: string): this {
        this.Key = key;
        if (!this.Metadata['Content-Type']) {
            this.setMetadata({ 'Content-Type': this.getContentType(key) });
        }
        return this;
    }

    /**
     * add metadata
     * @param metadata  key-value dictionary (only string is allowed for values.)
     */
    public setMetadata(metadata: Metadata): this {
        if (metadata['Content-Type']) {
            this.ContentType = metadata['Content-Type'];
            delete metadata['Content-Type'];
        } else if (metadata.origin) {
            this.ContentType = this.getContentType(metadata.origin);
        }

        this.Metadata = { md5: this.Metadata.md5, ...metadata }; // preserve 'md5' field
        return this;
    }

    /**
     * add tags
     * @param tags  key-value dictionary (only string is allowed for values.)
     */
    public setTags(tags: TagSet): this {
        this.Tagging = new URLSearchParams(tags).toString();
        return this;
    }

    /**
     * return PutObjectRequest object
     */
    public asParams(): AWS.S3.PutObjectRequest {
        let { Body, Bucket, ContentLength, ContentType, Key, Metadata, Tagging } = this;

        // generate object key if not specified
        //  - generate UUID filename
        //  - get extension from content-type or use 'json'
        if (!Key) {
            const ext = (this.ContentType && mime.extension(this.ContentType)) || 'json';
            Key = `${v4()}.${ext}`;
        }
        // generate content-type if not specified
        if (!ContentType) ContentType = this.getContentType(Key);

        return { Bucket, Key, Body, ContentLength, ContentType, Metadata, Tagging };
    }

    /**
     * guess content-type from filename
     * @param filename
     * @private
     */
    private getContentType = (filename: string): string | undefined => {
        const extname = path.extname(filename);
        return mime.contentType(extname) || undefined;
    };
}
