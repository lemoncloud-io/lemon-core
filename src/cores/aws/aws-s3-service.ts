/**
 * `s3s-service.js`
 * - common S3 services.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-07-19 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 * @date        2023-02-08 support of `listObject()`
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-11-13 modified aws to dynamic loading 
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
/** ****************************************************************************************************************
 *  Common Headers
 ** ****************************************************************************************************************/
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, $U, _log, _inf, _err } from '../../engine';
const NS = $U.NS('S3', 'blue');

import path from 'path';
import mime from 'mime-types';
import { v4 } from 'uuid';
import { CoreServices } from '../core-services';
import { Body, GetObjectOutput } from 'aws-sdk/clients/s3';
import { GETERR } from '../../common/test-helper';


/** ****************************************************************************************************************
 *  Core Types.
 ** ****************************************************************************************************************/

// import AWS from 'aws-sdk';
// export type Metadata = AWS.S3.Metadata;
// export type S3Object = AWS.S3.Object;
// export type ListObjectsV2Request = AWS.S3.ListObjectsV2Request
// export type PutObjectRequest = AWS.S3.PutObjectRequest
export type Metadata = ReturnType<typeof instance>['S3']['Metadata'];
export type S3Object = ReturnType<typeof instance>['S3']['Object'];
export type ListObjectsV2Request = ReturnType<typeof instance>['S3']['ListObjectsV2Request'];
export type PutObjectRequest = ReturnType<typeof instance>['S3']['PutObjectRequest'];
export interface TagSet {
    [key: string]: string;
}

/**
 * type: `HeadObjectResult`
 * - some properties of `HeadObjectOutput`
 */
export interface HeadObjectResult {
    ContentType: string;
    ContentLength: number;
    Metadata: Metadata;
    ETag: string;
    LastModified: string;
}

/**
 * type: `PutObjectResult`
 * - only some properties from origin-result.
 */
export interface PutObjectResult {
    Location: string;
    Bucket: string;
    Key: string;
    /**
     * An ETag is an opaque identifier assigned by a web server to a specific version of a resource found at a URL.
     */
    ETag: string;
    /**
     * Size of the body in bytes.
     */
    ContentLength?: number;
    /**
     * A standard MIME type describing the format of the object data.
     */
    ContentType?: string;
    /**
     * A map of metadata to store with the object in S3.
     */
    Metadata?: Metadata;
}

/**
 * type: `GetObjectResult`
 * - only some properties from origin-result.
 */
export interface GetObjectResult {
    /**
     * Size of the body in bytes.
     */
    ContentLength?: number;
    /**
     * A standard MIME type describing the format of the object data.
     */
    ContentType?: string;
    /**
     * A map of metadata to store with the object in S3.
     */
    Metadata?: Metadata;
    /**
     * Object data.
     */
    Body?: Body;
    /**
     * An ETag is an opaque identifier assigned by a web server to a specific version of a resource found at a URL.
     */
    ETag: string;
    /**
     * The number of tags, if any, on the object.
     */
    TagCount?: number;
}

/**
 * type: `ListObjectResult`
 * - only some properties from origin-result.
 */
export interface ListObjectResult {
    /** list of object infor */
    Contents: S3Object[];
    /** limit of each request */
    MaxKeys: number;
    /** total key-count read */
    KeyCount: number;
    /** flag to have more */
    IsTruncated?: boolean;
    /** valid only if truncated, and has more */
    NextContinuationToken?: string;
    /** internal error-string */
    error?: string;
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

const instance = () => {
    const _region = region();
    const config = { region: _region };
    const AWS = require('aws-sdk');
    return new AWS.S3(config);
};

/**
 * main service implement.
 */
export class AWSS3Service implements CoreS3Service {
    /**
     * environ name to use `bucket`
     */
    public static ENV_S3_NAME = 'MY_S3_BUCKET';
    /**
     * default `bucket` name
     */
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
     *
     * @param {string} key
     * @return  metadata object / null if not exists
     */
    public headObject = async (key: string): Promise<HeadObjectResult> => {
        if (!key) throw new Error(`@key (string) is required - headObject(${key ?? ''})`);

        const Bucket = this.bucket();
        const params = { Bucket, Key: key };

        // call s3.headObject.
        const s3 = instance();
        try {
            const data = await s3.headObject(params).promise();
            _log(NS, '> data =', $U.json({ ...data, Contents: undefined }));
            // const sample = {
            //     AcceptRanges: 'bytes',
            //     ContentLength: 47,
            //     ContentType: 'application/json; charset=utf-8',
            //     ETag: '"51f209a54902230ac3395826d7fa1851"',
            //     Expiration: 'expiry-date="Mon, 10 Apr 2023 00:00:00 GMT", rule-id="delete-old-json"',
            //     LastModified: '2023-02-08T14:53:12.000Z',
            //     Metadata: { contenttype: 'application/json; charset=utf8', md5: '51f209a54902230ac3395826d7fa1851' },
            //     ServerSideEncryption: 'AES256',
            // };
            const result: HeadObjectResult = {
                ContentType: data.ContentType,
                ContentLength: data.ContentLength,
                Metadata: data.Metadata,
                ETag: data.ETag,
                LastModified: $U.ts(data.LastModified),
            };
            return result;
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
        if (!content) throw new Error(`@content (buffer) is required - putObject()`);

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

            const result: PutObjectResult = {
                Bucket: data.Bucket,
                Location: data.Location,
                Key: data.Key,
                ETag: data.ETag,
                ContentType: params.ContentType,
                ContentLength: params.ContentLength,
                Metadata: params.Metadata,
            };
            return result;
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
    public getObject = async (key: string): Promise<GetObjectResult> => {
        if (!key) throw new Error(`@key (string) is required - getObject(${key ?? ''})`);

        const Bucket = this.bucket();
        const params = { Bucket, Key: key };

        //* call s3.getObject.
        const s3 = instance();
        try {
            const data: GetObjectOutput = await s3.getObject(params).promise();
            _log(NS, '> data.type =', typeof data);
            const { ContentType, ContentLength, Body, ETag, Metadata, TagCount } = data;
            const result: GetObjectResult = { ContentType, ContentLength, Body, ETag, Metadata };
            if (TagCount) result.TagCount = TagCount;
            return result;
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
    public getDecodedObject = async <T = object>(key: string): Promise<T> => {
        if (!key) throw new Error(`@key (string) is required - getDecodedObject(${key ?? ''})`);

        const Bucket = this.bucket();
        const params = { Bucket, Key: key };

        //* call s3.getObject.
        const s3 = instance();
        try {
            const data = await s3.getObject(params).promise();
            _log(NS, '> data.type =', typeof data);
            const content = data.Body.toString();
            return JSON.parse(content) as T;
        } catch (e) {
            _err(NS, '! err=', e);
            throw e;
        }
    };

    /**
     * get tag-set of object
     *
     * @param {string} key
     */
    public getObjectTagging = async (key: string): Promise<TagSet> => {
        if (!key) throw new Error(`@key (string) is required - getObjectTagging(${key ?? ''})`);
        const Bucket = this.bucket();
        const params = { Bucket, Key: key };

        //* call s3.getObjectTagging.
        const s3 = instance();
        try {
            const data = await s3.getObjectTagging(params).promise();
            _log(NS, `> data =`, $U.json(data));
            return data?.TagSet?.reduce((tagSet: any, tag: any) => {
                const { Key, Value } = tag;
                tagSet[Key] = Value;
                return tagSet;
            }, {} as TagSet);

        } catch (e) {
            _err(NS, '! err=', e);
            throw e;
        }
    };

    /**
     * delete object from bucket
     *
     * @param {string} key
     */
    public deleteObject = async (key: string): Promise<void> => {
        if (!key) throw new Error(`@key (string) is required - deleteObject(${key ?? ''})`);

        const Bucket = this.bucket();
        const params = { Bucket, Key: key };

        //* call s3.deleteObject.
        const s3 = instance();
        try {
            const data = await s3.deleteObject(params).promise();
            _log(NS, '> data =', $U.json(data));
        } catch (e) {
            _err(NS, '! err=', e);
            throw e;
        }
    };

    /**
     * list objects in bucket
     */
    public listObjects = async (options?: {
        /** keys that begin with the specified prefix. */
        prefix?: string;
        /** use to group keys */
        delimiter?: string;
        /** maximum number of keys returned in single request (default 10, max 1000) */
        limit?: number;
        /** flag to read all keys (each request contains `limit`) */
        unlimited?: boolean;
        /** same as NextContinuationToken */
        nextToken?: string;
        /** (optional) flag to throw error if error, or see `.error` in result */
        throwable?: boolean;
    }): Promise<ListObjectResult> => {
        // if (!key) throw new Error('@key is required!');
        const Prefix = options?.prefix ?? '';
        const Delimiter = options?.delimiter ?? '/';
        const MaxKeys = Math.min(options?.limit ?? 10, 1000);
        const unlimited = options?.unlimited ?? false;
        const nextToken = options?.nextToken;
        const throwable = options?.throwable ?? true;

        //* build the req-params.
        const Bucket = this.bucket();
        const params: ListObjectsV2Request = {
            Bucket,
            Prefix,
            Delimiter,
            MaxKeys,
        };
        if (nextToken) params.ContinuationToken = nextToken;

        //* call s3.listObjectsV2.
        const s3 = instance();
        const result: ListObjectResult = {
            Contents: null,
            MaxKeys,
            KeyCount: 0,
        };
        try {
            const data = await s3.listObjectsV2(params).promise();
            //INFO! - minimize log output....
            _log(NS, '> data =', $U.json({ ...data, Contents: undefined }));
            _log(NS, '> data[0] =', $U.json(data?.Contents?.[0]));
            if (data) {
                result.Contents = data.Contents;
                result.MaxKeys = data.MaxKeys;
                result.KeyCount = data.KeyCount;
                result.IsTruncated = data.IsTruncated;
                result.NextContinuationToken = data.NextContinuationToken;
            }

            //* list all keys.
            if (unlimited) {
                while (result.IsTruncated) {
                    //* fetch next list.
                    const res2 = await s3
                        .listObjectsV2({ ...params, ContinuationToken: result.NextContinuationToken })
                        .promise();

                    //* update contents.
                    result.Contents = result.Contents.concat(0 ? res2.Contents.slice(1) : res2.Contents);
                    result.IsTruncated = res2.IsTruncated;
                    result.KeyCount += $U.N(res2.KeyCount, 0);
                    result.NextContinuationToken = res2.NextContinuationToken;
                }
            }
        } catch (e) {
            _err(NS, '! err=', e);
            if (throwable) throw e;
            result.error = GETERR(e);
        }

        // returns.
        return result;
    };
}

/**
 * class `S3PutObjectRequestBuilder`
 *  - util class to build S3.PutObjectRequest parameter
 */
class S3PutObjectRequestBuilder {
    // properties consisting S3.PutObjectRequest
    private readonly Body: Buffer;
    private readonly Bucket: PutObjectRequest['Bucket'];
    private readonly ContentLength: PutObjectRequest['ContentLength'];
    private ContentType?: PutObjectRequest['ContentType'];
    private Key?: PutObjectRequest['Key'];
    private Metadata: PutObjectRequest['Metadata'];
    private Tagging?: PutObjectRequest['Tagging'];

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
    public asParams(): PutObjectRequest {
        const { Body, Bucket, ContentLength, Metadata, Tagging } = this;
        let { ContentType, Key } = this;

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
