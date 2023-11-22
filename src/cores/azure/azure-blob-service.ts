/**
 * `s3s-service.js`
 * - common S3 services.
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-09-18 initial azure blob service
 * 
 * @copyright (C) lemoncloud.io 2023 - All Rights Reserved.
 */
/** ****************************************************************************************************************
 *  Common Headers
 ** ****************************************************************************************************************/
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, $U, _log, _inf, _err } from '../../engine';
import { v4 } from 'uuid';
import { CoreServices } from '../core-services';
import { GETERR } from '../../common/test-helper';
// import { KeyVaultService } from './azure-keyvault-service';
import 'dotenv/config'

const NS = $U.NS('BLOB', 'blue');

const instance = () => {
    return (BlobService as any).instance();
};

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
    Metadata: ReturnType<typeof instance>['Metadata'];
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
    Metadata?: ReturnType<typeof instance>['Metadata'];
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
    Metadata: ReturnType<typeof instance>['Metadata'];
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
    Contents: ReturnType<typeof instance>['BlobItem'];
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

export interface CoreBlobService extends CoreServices {
    bucket: (target?: string) => string;
    putObject: (body: string, key?: string, metadata?: ReturnType<typeof instance>['Metadata'], tags?: TagSet) => Promise<PutObjectResult>;
    getObject: (key: string) => Promise<any>;
    getDecodedObject: (key: string) => Promise<any>;
    getObjectTagging: (key: string) => Promise<TagSet>;
    deleteObject: (key: string) => Promise<void>;
}

/** ****************************************************************************************************************
 *  Public Instance Exported.
 ** ****************************************************************************************************************/
const region = (): string => $engine.environ('REGION', 'koreacentral') as string;

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


/**
 * main service implement.
 */
export class BlobService implements CoreBlobService {
    // protected $kv: KeyVaultService;
    // constructor() {
    //     this.$kv = new KeyVaultService();
    // }

    /**
     * environ name to use `bucket`
     */
    public static ENV_BLOB_NAME = 'my-blob-container';
    /**
     * default `bucket` name
     */
    public static DEF_BLOB_BUCKET = process.env.BLOB_CONTAINER ?? 'blob-container';

    /**
     * get name of this
     */
    public name = () => `BLOB`;

    /**
     * hello
     */
    public hello = () => `azure-blob-service:${this.bucket()}`;

    /**
     * get target endpoint by name.
     */
    public bucket = (target?: string): string => environ(target, BlobService.ENV_BLOB_NAME, BlobService.DEF_BLOB_BUCKET);

    /**
     * get azure sdk for blob
     */
    // public static $kv: KeyVaultService = new KeyVaultService();
    public instance = async () => {
        const { BlobServiceClient, StorageSharedKeyCredential, BlobItem, Metadata } = require('@azure/storage-blob')
        const { StorageManagementClient } = require("@azure/arm-storage");
        const { DefaultAzureCredential } = require("@azure/identity");

        const account = process.env.STORAGE_ACCOUNT_RESOURCE
        const accountKey = process.env.STORAGE_ACCOUNT_ACCESS_KEY
        // const account = await BlobService.$kv.decrypt(process.env.STORAGE_ACCOUNT_RESOURCE);
        // const accountKey = await BlobService.$kv.decrypt(process.env.STORAGE_ACCOUNT_ACCESS_KEY);
        const subscriptionId = process.env.SUBSCRIPTION_ID;
        const resourceGroupName = process.env.RESOURCE_GROUP;

        const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);
        const blobServiceClient = new BlobServiceClient(
            `https://${account}.blob.core.windows.net`,
            sharedKeyCredential
        );

        const storageClient = new StorageManagementClient(new DefaultAzureCredential(), subscriptionId);
        return { storageClient, blobServiceClient, resourceGroupName, Metadata, BlobItem }
    };

    /**
     * retrieve metadata without returning the object
     *
     * @param {string} key
     * @return  metadata object / null if not exists
     */
    public headObject = async (key: string): Promise<HeadObjectResult> => {
        if (!key) throw new Error(`@key (string) is required - headObject(${key ?? ''})`);

        const { blobServiceClient } = await this.instance();
        const Bucket = this.bucket();
        const params = { Bucket, Key: key };
        const parts = key.split("/");
        const fileName = parts[parts.length - 1];
        const containerClient = blobServiceClient.getContainerClient(Bucket);
        const blobClient = containerClient.getBlobClient(fileName);

        try {
            const data = await blobClient.getProperties();
            _log(NS, '> data =', $U.json({ ...data, Contents: undefined }));

            const result: HeadObjectResult = {
                ContentType: data.contentType,
                ContentLength: data.contentLength,
                Metadata: data.metadata,
                ETag: data.etag,
                LastModified: $U.ts(data.lastModified),
            };
            return result
        } catch (e) {
            if (e.statusCode == 404) return null;
            _err(NS, '! err=', e);
            throw e;
        }
    };

    /** 
     * get a file from Blob Container
     *
     * @param {string} key
     */
    public getObject = async (key: string): Promise<any> => {
        if (!key) throw new Error(`@key (string) is required - getObject(${key ?? ''})`);

        const { blobServiceClient, Metadata } = await this.instance();
        const Bucket = this.bucket();
        const params = { Bucket, Key: key };
        const parts = key.split("/");
        const fileName = parts[parts.length - 1];
        const containerClient = blobServiceClient.getContainerClient(Bucket);
        const blobClient = containerClient.getBlobClient(fileName);
        const blockBlobClient = containerClient.getBlockBlobClient(fileName);

        async function getJsonData(blobResponse: any): Promise<any> {
            return new Promise<any>((resolve, reject) => {
                const chunks: Uint8Array[] = [];

                blobResponse.blobDownloadStream.on("data", (chunk: Uint8Array) => {
                    chunks.push(chunk);
                });

                blobResponse.blobDownloadStream.on("end", () => {
                    try {
                        const jsonData = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                        resolve(jsonData);
                    } catch (error) {
                        reject(error);
                    }
                });

                blobResponse.blobDownloadStream.on("error", (error: any) => {
                    reject(error);
                });
            });
        }
        try {
            const _data: any = await blobClient.download();
            const data: ReturnType<typeof instance>['Metadata'] = await getJsonData(_data);
            const properties = await blobClient.getProperties();
            const ContentType = properties.contentType;
            const ContentLength = properties.contentLength;
            const Metadata = properties.metadata;
            const ETag = properties.etag;
            const tagResponse = await blockBlobClient.getTags();

            _log(NS, '> data.type =', typeof data);
            const Body = JSON.stringify(data);
            const result: any = { ContentLength, ContentType, Body, ETag, Metadata };
            if (tagResponse) result.TagCount = Object.keys(tagResponse.tags).length;
            return result;
        } catch (e) {
            _err(NS, '! err=', e);
            throw e;
        }
    };
    /**
     * return decoded Object from Blob Container file.
     *
     * @param {string} key  ex) 'hello-0001.json' , 'dist/hello-0001.json
     */
    public getDecodedObject = async <T = object>(key: string): Promise<T> => {
        if (!key) throw new Error(`@key (string) is required - getDecodedObject(${key ?? ''})`);

        const Bucket = this.bucket();
        const params = { Bucket, Key: key };

        try {
            const data = await this.getObject(key).catch((e) => {
                _log(NS, '> data.type =', typeof data);
                _err(NS, '! err=', e);
                throw e;
            });
            if (!data) {
                throw new Error('Data not found');
            }
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
    public getObjectTagging = async (key: string): Promise<any> => {
        if (!key) throw new Error(`@key (string) is required - getObjectTagging(${key ?? ''})`);

        const { blobServiceClient } = await this.instance();
        const Bucket = this.bucket();
        const params = { Bucket, Key: key };
        const parts = key.split("/");
        const fileName = parts[parts.length - 1];
        const containerClient = blobServiceClient.getContainerClient(Bucket);
        const blobClient = containerClient.getBlobClient(fileName);

        try {
            const data = await blobClient.getTags();
            _log(NS, `> data =`, $U.json(data));
            return data?.tags
        } catch (e) {
            _err(NS, '! err=', e);
            throw e;
        }
    };

    /**
     * delete object from Blob Container
     *
     * @param {string} key
     */
    public deleteObject = async (key: string): Promise<void> => {
        if (!key) throw new Error(`@key (string) is required - deleteObject(${key ?? ''})`);

        const { blobServiceClient } = await this.instance();
        const Bucket = this.bucket();
        const params = { Bucket, Key: key };
        const parts = key.split("/");
        const fileName = parts[parts.length - 1];
        const containerClient = blobServiceClient.getContainerClient(Bucket);
        const blobClient = containerClient.getBlobClient(fileName);

        try {
            const data = await blobClient.delete();
            _log(NS, '> data =', $U.json(data));
        } catch (e) {
            _err(NS, '! err=', e);
            throw e;
        }
    };

    /**
     * list objects in Blob Container
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
    }): Promise<any> => {
        // if (!key) throw new Error('@key is required!');
        const Prefix = options?.prefix ?? '';
        const Delimiter = options?.delimiter ?? '/';
        const MaxKeys = Math.min(options?.limit ?? 10, 1000);
        const unlimited = options?.unlimited ?? false;
        const nextToken = options?.nextToken;
        const throwable = options?.throwable ?? true;

        //* build the req-params.
        const Bucket = this.bucket()
        const { blobServiceClient } = await this.instance();
        const containerClient = blobServiceClient.getContainerClient(Bucket);
        const result: any = {
            Contents: [],
            MaxKeys,
            KeyCount: 0,
            IsTruncated: false,
        };
        try {
            let count = 0;
            result.MaxKeys = MaxKeys
            let iterator = containerClient.listBlobsFlat().byPage({
                maxPageSize: MaxKeys,
                ...(nextToken ? { continuationToken: nextToken } : {}),
            });

            let response = (await iterator.next()).value;
            if (response !== undefined && response?.segment !== undefined && response?.segment?.blobItems !== undefined) {
                for (const blob of response?.segment?.blobItems) {
                    result.Contents.push({
                        Key: blob.name,
                        Size: blob.properties.contentLength,
                    });
                }
                count++
                result.NextContinuationToken = response?.continuationToken
                if (!unlimited) {
                    result.KeyCount = count
                    result.IsTruncated = true;
                    return result
                }
            }

            while (response !== undefined && response?.segment !== undefined && response?.segment?.blobItems !== undefined) {
                iterator = containerClient.listBlobsFlat().byPage({
                    maxPageSize: MaxKeys,
                    continuationToken: result.NextContinuationToken,
                });
                response = (await iterator.next()).value;
                result.NextContinuationToken = response?.continuationToken

                if (response?.segment?.blobItems.length > 0 && response !== undefined && response?.segment !== undefined && response?.segment?.blobItems !== undefined) {
                    for (const blob of response.segment.blobItems) {
                        result.Contents.push({
                            Key: blob.name,
                            Size: blob.properties.contentLength,
                        });
                    }
                    count++;
                }
            }
            result.KeyCount = count;
        } catch (e) {
            _err(NS, '! err=', e);
            if (throwable) throw e;
            result.error = GETERR(e);
        }
        return result;
    };

    /**
     * upload a file to Blob Container
     *
     *
     * @param {string|Buffer} content   content body
     * @param {string} key              (optional) S3 key to put
     * @param {Metadata} metadata       (optional) metadata to store
     * @param {object} tags             (optional) tag set
     */
    public putObject = async (
        content: string | Buffer,
        key?: string,
        metadata?: ReturnType<typeof instance>['Metadata'],
        tags?: TagSet,
    ): Promise<any> => {
        if (!content) throw new Error(`@content (buffer) is required - putObject()`);

        function generateBlobName(): string {
            const uuid = v4();
            return `${uuid}.json`;
        }
        if (!key) key = generateBlobName();

        const { blobServiceClient, storageClient, resourceGroupName } = await this.instance();
        const Bucket = this.bucket();
        const parts = key.split("/");
        const fileName = parts[parts.length - 1];
        const containerClient = blobServiceClient.getContainerClient(Bucket);
        const blobClient = containerClient.getBlobClient(fileName);

        //* upsert
        const blobExists = await blobClient.exists();
        if (blobExists) {
        } else {
            const blockBlobClient = containerClient.getBlockBlobClient(fileName);
            await blockBlobClient.upload(content, content.length, {
                blobHTTPHeaders: {
                    blobContentType: "application/json; charset=utf-8"
                }
            });
        }
        //* metadata has ContentType
        if (metadata && metadata.hasOwnProperty('ContentType')) {
            await blobClient.setHTTPHeaders({
                blobContentType: metadata.ContentType,
            });
        }
        const properties = await blobClient.getProperties();
        const contentType = properties.contentType;
        const contentLength = properties.contentLength;
        const eTag = properties.etag;
        _log(NS, `> params.ContentType =`, contentType);
        _log(NS, `> params.ContentLength =`, contentLength);
        _log(NS, `> params.Metadata =`, metadata);
        _log(NS, `> params.Tagging =`, eTag);
        try {
            const blockBlobClient = containerClient.getBlockBlobClient(fileName);
            await blockBlobClient.upload(content, content.length, {
                blobHTTPHeaders: {
                    blobContentType: "application/json; charset=utf-8"
                }
            });
            const storageAccount = await storageClient.storageAccounts.getProperties(resourceGroupName, blobClient.accountName);

            if (metadata) await blobClient.setMetadata(metadata);
            if (tags) await blobClient.setTags(tags);

            const result: any = {
                Bucket: Bucket,
                Location: storageAccount.location,
                Key: key,
                ETag: eTag,
                ContentType: contentType,
                ContentLength: contentLength,
                Metadata: metadata,
            };
            return result;
        } catch (e) {
            _err(NS, `! err[${Bucket}] =`, e);
            throw e;
        }
    };
}