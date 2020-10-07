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
import url from 'url';
import fs from 'fs';
import util from 'util';
import AWS from 'aws-sdk';
import request from 'request';
import sharp from 'sharp';
import mime from 'mime-types';
import { v4 } from 'uuid';
import { CoreServices } from '../core-services';

/** ****************************************************************************************************************
 *  Core Types.
 ** ****************************************************************************************************************/
export interface TagSet {
    [key: string]: string;
}

export interface PutObjectResult {
    Bucket: string;
    Key: string;
    Location: string;
}

export interface CoreS3Service extends CoreServices {
    bucket: (target?: string) => string;
    putObject: (body: string, fileName?: string, tags?: TagSet) => Promise<PutObjectResult>;
    putObjectByUrl: (
        urlString: string,
        directory?: string,
        preserveFileName?: boolean,
        tags?: TagSet,
    ) => Promise<PutObjectResult>;
    getObject: (fileName: string) => Promise<any>;
    getDecodedObject: (fileName: string) => Promise<any>;
    getObjectTagging: (fileName: string) => Promise<TagSet>;
    deleteObject: (fileName: string) => Promise<void>;
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
    public hello = () => `aws-s3-service:${''}`;

    /**
     * get target endpoint by name.
     */
    public bucket = (target?: string): string => environ(target, AWSS3Service.ENV_S3_NAME, AWSS3Service.DEF_S3_BUCKET);

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
     * @param {string} body     content body
     * @param {string} fileName S3 path to save
     * @param {object} tags     (optional) tag set
     */
    public putObject = async (body: string, fileName?: string, tags?: TagSet): Promise<PutObjectResult> => {
        _log(NS, `putObject(${fileName})...`);
        if (!body) throw new Error('@body is required!');

        // create file object
        fileName = fileName || `${v4()}.json`;
        const file = await new File(fileName).load(body);

        // upload
        return this.uploadFile(file, fileName, tags);
    };

    /**
     * upload object at given URL to S3 bucket
     *  - support both local path and remote URL
     *
     * @param {string} urlString            URL or path of file
     * @param {string} directory            target S3 directory
     * @param {boolean} preserveFileName    (optional) use original filename if set true, otherwise UUID filename is generated (default: false)
     * @param {object} tags (optional)      tag set
     */
    public putObjectByUrl = async (
        urlString: string,
        directory: string = '',
        preserveFileName: boolean = false,
        tags?: TagSet,
    ): Promise<PutObjectResult> => {
        _log(NS, `putByUrl(${urlString})...`);
        if (!urlString) throw new Error(`@urlString is required!`);
        directory = directory || '';

        // load file
        const file = await new File(urlString).load();

        // generate key using UUID
        const fileName = preserveFileName ? file.basename : `${v4()}${file.extname}`;
        const key = path.join(directory, fileName);

        // upload
        return this.uploadFile(file, key, tags);
    };

    /**
     * get a file from S3 Bucket
     *
     * @param {string} fileName
     */
    public getObject = async (fileName: string): Promise<any> => {
        if (!fileName) throw new Error('@fileName is required!');

        const Bucket = await this.bucket();
        const params = { Bucket, Key: fileName };

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
     * @param {string} fileName ex) 'hello-0001.json' , 'dist/hello-0001.json
     */
    public getDecodedObject = async (fileName: string): Promise<any> => {
        if (!fileName) throw new Error('@fileName is required!');

        const Bucket = await this.bucket();
        const params = { Bucket, Key: fileName };

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
     * @param {string} fileName
     */
    public getObjectTagging = async (fileName: string): Promise<TagSet> => {
        const Bucket = await this.bucket();
        const params = { Bucket, Key: fileName };

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
     * @param {string} fileName
     */
    public deleteObject = async (fileName: string): Promise<void> => {
        if (!fileName) throw new Error('@fileName is required!');

        const Bucket = await this.bucket();
        const params = { Bucket, Key: fileName };

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

    /**
     * core upload logic
     * @param {File} file   File object
     * @param {string} key  S3 key to upload
     * @param {TagSet} tags (optional) tags to save
     * @private
     */
    private async uploadFile(file: File, key: string, tags?: TagSet): Promise<PutObjectResult> {
        // metadata
        const metadata: AWS.S3.Metadata = {
            md5: file.contentMD5,
        };
        if (file.isRemoteFile) metadata.origin = file.url;
        if (file.contentType.startsWith('image')) {
            const imageMeta = await sharp(file.buffer).metadata();
            const keysToRead: (keyof sharp.Metadata)[] = [
                'width',
                'height',
                'space', // color space ('srgb', 'rgb', 'cmyk', ...)
                'channels', // 3 for sRGB, 4 for CMYK
                'depth', // pixel format
                'density', // DPI
                'orientation', // EXIF Orientation
            ];
            keysToRead.forEach(key => {
                if (imageMeta[key]) metadata[key] = `${imageMeta[key]}`;
            });
        }

        // construct upload parameters
        const params: AWS.S3.PutObjectRequest = {
            Bucket: this.bucket(),
            Key: key,
            // ACL: 'public-read',
            Body: file.buffer,
            ContentType: file.contentType,
            ContentLength: file.contentLength,
            ContentMD5: file.contentMD5,
            Metadata: metadata,
        };
        if (tags) params.Tagging = new URLSearchParams(tags).toString();

        //! call s3.upload.
        const s3 = instance();
        try {
            const { Bucket, Key, Location } = await s3.upload(params).promise();
            _log(NS, `> data[${Bucket}].Key =`, Key);
            return { Bucket, Key, Location };
        } catch (e) {
            _err(NS, `! err[${params.Bucket}] =`, e);
            throw e;
        }
    }
}

/**
 * class `File`
 *  - util class to get content information
 */
class File {
    /**
     * is file location remote or local
     * @readonly
     */
    public readonly isRemoteFile: boolean;

    // private variables
    private readonly urlObject: url.Url;
    private _buffer: Buffer;
    private _contentType: string;
    private _contentLength: number;
    private _contentMD5: string;

    /**
     * default constructor
     * @param urlString URL or local path of file
     */
    public constructor(urlString?: string) {
        const urlObject = url.parse(urlString || '');

        if (urlObject.protocol == 'http:' || urlObject.protocol == 'https:') {
            this.isRemoteFile = true;
        } else if (urlObject.protocol == 'file:' || !urlObject.protocol) {
            this.isRemoteFile = false;
        } else {
            throw new Error(`.urlString (string) has unsupported protocol [${urlObject.protocol}]`);
        }

        this.urlObject = urlObject;
    }

    /**
     * load file content
     * @param {string} content (optional) load content from URL if not given
     */
    public async load(content?: string): Promise<this> {
        if (content) {
            this._buffer = Buffer.from(content);
        } else {
            if (this.isRemoteFile) {
                const requestGet = util.promisify(request.get.bind(request));
                _log(`download remote file... (${this.urlObject.href})`);

                // 'encoding=null' is required to receive binary data
                const { statusCode, headers, body } = await requestGet(this.urlObject.href, { encoding: null });
                if (statusCode != 200) throw new Error(`HTTP error (statusCode=${statusCode})`);

                this._buffer = body;
                this._contentType = `${headers['content-type'] || ''}`;
                this._contentLength = $U.N(headers['content-length']);
            } else {
                let filepath = this.urlObject.pathname;
                if (!path.isAbsolute(filepath)) filepath = path.resolve(filepath);

                _log(`read local file... (${filepath}`);
                this._buffer = fs.readFileSync(filepath);
            }
        }

        // ensure content-type and content-length properly set
        const extname = path.extname(this.urlObject.pathname);
        this._contentType = this._contentType || mime.contentType(extname) || '';
        this._contentLength = this._contentLength || this.buffer.length;
        // calculate MD5 hash
        this._contentMD5 = $U.md5(this._buffer, 'base64');

        return this;
    }

    public get url(): string {
        return url.format(this.urlObject);
    }

    /**
     * basename of file
     */
    public get basename(): string {
        return path.basename(this.urlObject.pathname || '');
    }

    /**
     * extname of file
     */
    public get extname(): string {
        if (this._contentType) {
            // get default extension
            let extension = mime.extension(this._contentType);
            // prefer not to use 4-letter extension
            if (!extension || extension.length > 3) {
                const extensions = mime.extensions[this.contentType.split(';')[0]];
                if (extensions && extensions.length > 1 && extensions[1].length <= 3) {
                    extension = extensions[1];
                }
            }
            if (extension) return `.${extension}`;
        }
        return path.extname(this.urlObject.pathname || '');
    }

    /**
     * buffer of file content
     */
    public get buffer(): Buffer {
        return this._buffer;
    }

    /**
     * content-type of file
     */
    public get contentType(): string {
        return this._contentType;
    }

    /**
     * content-length of file
     */
    public get contentLength(): number {
        return this._contentLength;
    }

    /**
     * content-MD5 of file
     */
    public get contentMD5(): string {
        return this._contentMD5;
    }
}
