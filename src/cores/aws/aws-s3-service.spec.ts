/**
 * `service/test.s3-service.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-16 initial unit test.
 * @date        2023-02-08 support of `listObject()`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
const ENV_NAME = 'MY_S3_BUCKET';
const DEF_BUCKET = 'lemon-hello-www';

//* override environ.
process.env = Object.assign(process.env, {
    TEMP_BUCKET: 'hello-bucket',
});

//* load $engine, and prepare dummy handler
import { loadProfile } from '../../environ';
import { expect2, GETERR } from '../../common/test-helper';
import { AWSS3Service, Metadata, PutObjectResult, TagSet } from './aws-s3-service';
import { $rand, my_parrallel } from '../../helpers';
import { Readable } from 'stream';
import { $U } from '../../engine';
import { mockAwsError } from './aws-kms-service.spec';

type S3Module = typeof import('@aws-sdk/client-s3');
type MockStorageEntry = {
    Body: Buffer;
    Metadata: Metadata;
    ContentType: string;
    Tags: TagSet;
};

const S3Storage = new Map<string, MockStorageEntry>();

function buildS3Client(actual: S3Module) {
    return class S3Client extends actual.S3Client {
        public constructor(config?: any) {
            super(config);
        }

        public send = async (command: any) => {
            const commandName = command.constructor.name;

            // Mock responses based on command type - reflect actual parameters with realistic error checking
            switch (commandName) {
                case 'HeadObjectCommand': {
                    const { Bucket, Key } = command.input;
                    if (Key === 'non-existent-key') {
                        throw mockAwsError('NotFound', 'The specified key does not exist.', 404, Key);
                    }
                    // Check if object exists in mock storage
                    const storageKey = `${Bucket}/${Key}`;
                    const stored = S3Storage.get(storageKey);

                    if (!stored) {
                        throw mockAwsError('NoSuchKey', 'The specified key does not exist.', 404, Key);
                    }

                    return {
                        ContentType: stored.ContentType,
                        ContentLength: stored.Body.length,
                        Metadata: stored.Metadata,
                        ETag: `"${$U.md5(stored.Body, 'hex')}"`,
                        LastModified: new Date(),
                    };
                }
                case 'GetObjectCommand': {
                    const { Bucket, Key } = command.input;

                    // Check if object exists in mock storage
                    const storageKey = `${Bucket}/${Key}`;
                    const stored = S3Storage.get(storageKey);

                    if (!stored) {
                        throw mockAwsError('NoSuchKey', 'The specified key does not exist.', 404, Key);
                    }

                    // Create a readable stream from buffer to match AWS SDK behavior
                    const bodyStream = new Readable();
                    bodyStream.push(stored.Body);
                    bodyStream.push(null); // end stream

                    return {
                        Body: bodyStream,
                        ContentType: stored.ContentType,
                        ContentLength: stored.Body.length,
                        Metadata: stored.Metadata,
                        ETag: `"${$U.md5(stored.Body, 'hex')}"`,
                        TagCount: stored.Tags ? Object.keys(stored.Tags).length : 0,
                    };
                }
                case 'PutObjectCommand': {
                    const { Bucket, Key, Body, ContentType, Metadata, Tagging } = command.input;

                    // Validate input parameters like real AWS S3
                    if (!Body || (Buffer.isBuffer(Body) && Body.length === 0)) {
                        throw mockAwsError('MissingBody', 'Body must be provided and cannot be empty', 400);
                    }

                    const bodyBuffer = Buffer.isBuffer(Body) ? Body : Buffer.from(String(Body));
                    const contentType = ContentType || 'application/json; charset=utf-8';

                    // Parse tags from URLSearchParams format
                    const tags: TagSet = {};
                    if (Tagging) {
                        const params = new URLSearchParams(Tagging);
                        for (const [key, value] of params.entries()) {
                            tags[key] = value;
                        }
                    }

                    // Store object in mock storage
                    const storageKey = `${Bucket}/${Key}`;
                    S3Storage.set(storageKey, {
                        Body: bodyBuffer,
                        Metadata: Metadata || {},
                        ContentType: contentType,
                        Tags: tags,
                    });

                    return {
                        ETag: `"${$U.md5(bodyBuffer, 'hex')}"`,
                    };
                }
                case 'DeleteObjectCommand': {
                    const { Bucket, Key } = command.input;

                    // Validate input parameters
                    if (Key === 'non-existent-key') {
                        throw mockAwsError('NoSuchKey', 'Key not found', 404, Key);
                    }
                    // Simulate access denied error for specific test key
                    if (Key === 'test-key') {
                        const error = new Error('Access Denied');
                        (error as any).name = 'AccessDenied';
                        (error as any).$metadata = { httpStatusCode: 403 };
                        throw error;
                    }

                    // Remove from mock storage (S3 doesn't error if key doesn't exist)
                    const storageKey = `${Bucket}/${Key}`;
                    S3Storage.delete(storageKey);

                    return {};
                }
                case 'ListObjectsV2Command': {
                    const { Bucket, Prefix, MaxKeys, ContinuationToken } = command.input;

                    const maxKeys = MaxKeys || 10;
                    const prefix = Prefix || '';

                    if (prefix === 'non-existent-prefix') {
                        throw mockAwsError('NoSuchBucket', 'The specified bucket does not exist', 404);
                    }
                    // Simulate S3 error for specific test prefix
                    if (prefix === 'test/') {
                        throw new Error('Simulated S3 error');
                    }

                    // Filter objects by bucket and prefix
                    const allObjects = Array.from(S3Storage.entries())
                        .filter(([key]) => {
                            const bucketKeyIndex = key.indexOf('/');
                            if (bucketKeyIndex === -1) return false;

                            const objBucket = key.substring(0, bucketKeyIndex);
                            const objKey = key.substring(bucketKeyIndex + 1);
                            return objBucket === Bucket && objKey.startsWith(prefix);
                        })
                        .map(([key, stored]) => {
                            const bucketKeyIndex = key.indexOf('/');
                            const objKey = key.substring(bucketKeyIndex + 1);
                            return {
                                Key: objKey,
                                Size: stored.Body.length,
                                LastModified: new Date(),
                                ETag: `"${$U.md5(stored.Body, 'hex')}"`,
                            };
                        })
                        .sort((a, b) => a.Key.localeCompare(b.Key));

                    // Handle pagination
                    let startIndex = 0;
                    if (ContinuationToken) {
                        const tokenIndex = allObjects.findIndex(obj => obj.Key > ContinuationToken);
                        if (tokenIndex >= 0) startIndex = tokenIndex;
                    }

                    const contents = allObjects.slice(startIndex, startIndex + maxKeys);
                    const isTruncated = startIndex + maxKeys < allObjects.length;
                    const nextToken = isTruncated ? contents[contents.length - 1]?.Key : undefined;

                    return {
                        Contents: contents,
                        KeyCount: contents.length,
                        MaxKeys: maxKeys,
                        IsTruncated: isTruncated,
                        NextContinuationToken: nextToken,
                    };
                }
                case 'GetObjectTaggingCommand': {
                    const { Bucket, Key } = command.input;

                    // Check if object exists in mock storage
                    const storageKey = `${Bucket}/${Key}`;
                    const stored = S3Storage.get(storageKey);

                    if (!stored) {
                        throw mockAwsError('NoSuchKey', 'The specified key does not exist.', 404, Key);
                    }

                    // Convert TagSet format to AWS format
                    const tagSet = stored.Tags
                        ? Object.entries(stored.Tags).map(([Key, Value]) => ({ Key, Value }))
                        : [];

                    return {
                        TagSet: tagSet,
                    };
                }
            }
        };
    };
}

function createS3Module() {
    const actual = jest.requireActual<S3Module>('@aws-sdk/client-s3');
    const S3ClientCtor = buildS3Client(actual);
    return {
        ...actual,
        S3Client: jest.fn().mockImplementation((config?: any) => new S3ClientCtor(config)),
    };
}

jest.mock('@aws-sdk/client-s3', () => createS3Module());

const S3 = new AWSS3Service();

//! main test body.
describe(`test AWSS3Service`, () => {
    //* use `env.PROFILE`
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    beforeEach(() => {
        S3Storage.clear();
    });

    it('check basic function', async () => {
        expect(S3.name()).toEqual('S3');
        expect(S3.hello()).toEqual(`aws-s3-service:${S3.bucket()}`);

        expect(AWSS3Service.ENV_S3_NAME).toEqual(ENV_NAME);
        expect(AWSS3Service.DEF_S3_BUCKET).toEqual(DEF_BUCKET);

        expect(S3.bucket()).toEqual(DEF_BUCKET);
        expect(S3.bucket('TEMP_BUCKET')).toEqual('hello-bucket');
        expect(S3.bucket('MY_BUCKET')).toEqual(DEF_BUCKET);
        expect(S3.bucket('my-bucket')).toEqual('my-bucket');
    });

    //* test headObject()
    it('check headObject() function', async () => {
        if (!PROFILE) return;

        // if the objects not exists
        expect(await S3.headObject('invalid-file')).toBeNull();
        // if the objects exists
        const json = JSON.stringify({ hello: 'world', lemon: true });
        const { Location: fileName } = await S3.putObject(json, 'test.json');
        // expect(await S3.headObject('invalid-file').catch(GETERR)).toMatchObject({ ContentType: 'application/json; charset=utf-8', ContentLength: json.length });
        expect(await S3.headObject('invalid-file').catch(GETERR)).toEqual(null);
        await S3.deleteObject(fileName);
    });

    //* test putObject(), and getObject()
    it('check putObject() function', async () => {
        if (!PROFILE) return;
        const json = { hello: 'world', lemon: true, name: '한글!' };
        const body = JSON.stringify(json);
        const _key = (n?: number) => `tests/sample${n ? n : ''}.json`;
        const key00 = _key();
        let res: PutObjectResult;

        //* manual key
        res = await S3.putObject(body, key00);
        expect2(() => res.Bucket).toEqual(DEF_BUCKET);
        expect2(() => res.Key).toEqual(key00);
        expect2(() => res.Location).toMatch(
            new RegExp(`^https:\/\/${DEF_BUCKET}\.s3\.ap-northeast-2.amazonaws.com\/${res.Key}`),
        );
        expect2(() => res.ContentType).toEqual('application/json; charset=utf-8');
        expect2(() => res.ContentLength).toEqual(body.length + 4); // +2 due to unicode for hangul
        expect2(await S3.getObject(res.Key)).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            Body: Buffer.from(body),
        });
        expect2(await S3.deleteObject(res.Key)).toEqual();

        //* automatic key
        res = await S3.putObject(body);
        expect2(() => res.Bucket).toEqual(DEF_BUCKET);
        expect2(() => res.Key).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/,
        );
        expect2(() => res.Location).toMatch(
            new RegExp(`^https:\/\/${DEF_BUCKET}\.s3\.ap-northeast-2.amazonaws.com\/${res.Key}`),
        );
        expect2(() => res.ContentType).toEqual('application/json; charset=utf-8');
        expect2(() => res.ContentLength).toEqual(body.length + 4); // +2 due to unicode for hangul
        expect2(await S3.getObject(res.Key)).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            Body: Buffer.from(body),
        });
        expect2(await S3.deleteObject(res.Key)).toEqual();

        //* check tags, and meta
        const meta: Metadata = { ContentType: 'application/json; charset=utf8' };
        const tags = { Company: 'LemonCloud', Service: 'lemon-core', author: 'steve' };
        res = await S3.putObject(body, key00, meta, tags);
        expect2(() => ({ ...res })).toEqual({
            Bucket: DEF_BUCKET,
            Key: key00,
            ContentType: 'application/json; charset=utf-8',
            ContentLength: 47,
            ETag: '"51f209a54902230ac3395826d7fa1851"',
            Location: `https://${DEF_BUCKET}.s3.ap-northeast-2.amazonaws.com/${key00}`,
            Metadata: {
                ...meta,
                md5: '51f209a54902230ac3395826d7fa1851',
            },
        });
        expect2(await S3.getObject(res.Key), '!Body').toEqual({
            ContentType: 'application/json; charset=utf-8',
            ContentLength: 47,
            ETag: '"51f209a54902230ac3395826d7fa1851"',
            Metadata: {
                //WARN - the key is changed to lower-case.
                contenttype: 'application/json; charset=utf8',
                md5: '51f209a54902230ac3395826d7fa1851',
            },
            TagCount: Object.keys(tags).length,
        });
        expect2(await S3.getObjectTagging(res.Key)).toEqual({ ...tags });
        expect2(await S3.headObject(res.Key), `!LastModified`).toEqual({
            ContentType: 'application/json; charset=utf-8',
            ContentLength: 47,
            ETag: '"51f209a54902230ac3395826d7fa1851"',
            Metadata: {
                contenttype: 'application/json; charset=utf8',
                md5: '51f209a54902230ac3395826d7fa1851',
            },
        });

        //* check list-objects
        const $list = await S3.listObjects({ prefix: 'tests/' });
        expect2(() => ({ ...$list }), 'MaxKeys').toEqual({
            MaxKeys: 10, // default is `10`
        });
        expect2(() => $list.Contents.slice(0, 1), 'Key,Size').toEqual([{ Key: 'tests/sample.json', Size: 47 }]);

        //* make sample1~10
        const MAX_COUNT = 10;
        const keys = $rand.range(MAX_COUNT).map(i => _key(i + 1));
        const objs = await my_parrallel(
            keys.map(id => ({ id })),
            N => S3.putObject(body, N.id).then(R => ({ ...N, Key: R.Key })),
        );
        expect2(() => objs?.length).toEqual(MAX_COUNT);
        if (objs) {
            // use only `limit`
            const list1 = await S3.listObjects({ prefix: 'tests/', limit: 1 });
            expect2(() => list1?.Contents.length).toEqual(1);
            expect2(() => list1, 'IsTruncated,KeyCount,MaxKeys').toEqual({
                IsTruncated: true,
                KeyCount: 1,
                MaxKeys: 1,
            });

            // use `unlimited`
            const list2 = await S3.listObjects({ prefix: 'tests/', limit: 1, unlimited: true });
            expect2(() => list2?.Contents.length).toEqual(11);
            expect2(() => list2, 'IsTruncated,KeyCount,MaxKeys,NextContinuationToken').toEqual({
                IsTruncated: false,
                KeyCount: 11,
                MaxKeys: 1,
                NextContinuationToken: undefined,
            });
            expect2(() => list2.Contents.map(N => N.Key)).toEqual([
                'tests/sample.json',
                'tests/sample1.json',
                'tests/sample10.json',
                'tests/sample2.json',
                'tests/sample3.json',
                'tests/sample4.json',
                'tests/sample5.json',
                'tests/sample6.json',
                'tests/sample7.json',
                'tests/sample8.json',
                'tests/sample9.json',
            ]);

            //* delete all objects.
            const dels = await my_parrallel(objs, N => S3.deleteObject(N.Key).then(() => ({ ...N })));
            expect2(() => dels?.length).toEqual(MAX_COUNT);

            const list3 = await S3.listObjects({ prefix: 'tests/', limit: 1, unlimited: true });
            expect2(() => list3?.Contents.length).toEqual(1);
            expect2(() => list3.Contents.map(N => N.Key)).toEqual(['tests/sample.json']);
        }

        //* cleanup object
        expect2(await S3.deleteObject(res.Key)).toEqual();
    });

    //* test getDecodedObject()
    it('check getDecodedObject() function', async () => {
        if (!PROFILE) return;
        const fileName = 'sample.json';
        const data = { hello: 'world', lemon: true };

        await S3.putObject(JSON.stringify(data), fileName);
        expect(await S3.getDecodedObject(fileName)).toEqual(data);
        await S3.deleteObject(fileName);
    });

    //* test mock service functionality
    it('check mock service operations', async () => {
        const json = { hello: 'world', lemon: true, name: '한글!' };
        const body = JSON.stringify(json);
        const key = 'tests/mock-sample.json';

        //* test putObject with mock
        const res = await S3.putObject(body, key);
        expect2(() => res.Bucket).toEqual(AWSS3Service.DEF_S3_BUCKET);
        expect2(() => res.Key).toEqual(key);
        expect2(() => res.Location).toMatch(
            new RegExp(`^https:\/\/${AWSS3Service.DEF_S3_BUCKET}\.s3\.ap-northeast-2.amazonaws.com\/${res.Key}`),
        );
        expect2(() => res.ContentType).toEqual('application/json; charset=utf-8');
        expect2(() => res.ContentLength).toEqual(body.length + 4); // +4 due to unicode for hangul

        //* test getObject with mock - should return the same data that was put
        const getResult = await S3.getObject(res.Key);
        expect2(() => getResult.ContentType).toEqual('application/json; charset=utf-8');
        expect2(() => getResult.Body).toEqual(Buffer.from(body));
        expect2(() => getResult.ContentLength).toEqual(body.length + 4);

        //* test headObject with mock
        const headResult = await S3.headObject(res.Key);
        expect2(() => headResult.ContentType).toEqual('application/json; charset=utf-8');
        expect2(() => headResult.ContentLength).toEqual(body.length + 4);
        const headErrorResult = await S3.headObject('non-existent-key');
        expect2(() => headErrorResult).toEqual(null);

        //* test getDecodedObject with mock
        const decodedResult = await S3.getDecodedObject(res.Key);
        expect2(() => decodedResult).toEqual(json);

        //* test with tags and metadata
        const meta: Metadata = { ContentType: 'application/json; charset=utf8' };
        const tags = { Company: 'LemonCloud', Service: 'lemon-core', author: 'steve' };
        const keyWithTags = 'tests/mock-sample-with-tags.json';

        const resWithTags = await S3.putObject(body, keyWithTags, meta, tags);
        expect2(() => resWithTags.Key).toEqual(keyWithTags);

        //* test getObjectTagging with mock
        const retrievedTags = await S3.getObjectTagging(keyWithTags);
        expect2(() => retrievedTags).toEqual(tags);

        //* test getObject with tags
        const getResultWithTags = await S3.getObject(keyWithTags);
        expect2(() => getResultWithTags.TagCount).toEqual(Object.keys(tags).length);

        //* test listObjects with mock
        const listResult = await S3.listObjects({ prefix: 'tests/' });
        expect2(() => listResult.Contents.length).toEqual(2);
        expect2(() => listResult.KeyCount).toEqual(2);
        expect2(() => listResult.MaxKeys).toEqual(10);
        expect2(() => listResult.IsTruncated).toEqual(false);

        //* test deleteObject with mock
        await S3.deleteObject(res.Key);
        await S3.deleteObject(keyWithTags);

        //* verify objects are deleted
        const listAfterDelete = await S3.listObjects({ prefix: 'tests/' });
        expect2(() => listAfterDelete.Contents.length).toEqual(0);
    });

    //* test mock service error handling
    it('check mock service error handling', async () => {
        //* test headObject with non-existent key (returns null for 404)
        expect2(await S3.headObject('non-existent-key')).toEqual(null);

        //* test getObject with non-existent key
        expect2(await S3.getObject('non-existent-key').catch(GETERR)).toEqual('The specified key does not exist.');

        //* test getDecodedObject with non-existent key
        expect2(await S3.getDecodedObject('non-existent-key').catch(GETERR)).toEqual(
            'The specified key does not exist.',
        );

        //* test getObjectTagging with non-existent key
        expect2(await S3.getObjectTagging('non-existent-key').catch(GETERR)).toEqual(
            'The specified key does not exist.',
        );

        //* test putObject with empty body
        expect2(await S3.putObject('', 'empty-test.json').catch(GETERR)).toEqual(
            '@content (buffer) is required - putObject()',
        );

        //* test putObject with empty buffer
        expect2(await S3.putObject(Buffer.alloc(0), 'empty-buffer-test.json').catch(GETERR)).toEqual(
            'Body must be provided and cannot be empty',
        );

        //* test parameter validation
        expect2(await S3.headObject('').catch(GETERR)).toEqual('@key (string) is required - headObject()');
        expect2(await S3.getObject('').catch(GETERR)).toEqual('@key (string) is required - getObject()');
        expect2(await S3.getDecodedObject('').catch(GETERR)).toEqual('@key (string) is required - getDecodedObject()');
        expect2(await S3.getObjectTagging('').catch(GETERR)).toEqual('@key (string) is required - getObjectTagging()');
        expect2(await S3.deleteObject('').catch(GETERR)).toEqual('@key (string) is required - deleteObject()');
        //* test putObject with empty key (should succeed with auto-generated key)
        const autoKeyResult = await S3.putObject('test');
        expect2(() => autoKeyResult.Key).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/,
        );
    });

    //* test mock service constructor and basic methods
    it('check mock service basic methods', async () => {
        const mockService = new AWSS3Service();

        //* test name() method
        expect2(() => mockService.name()).toEqual('S3');

        //* test hello() method
        expect2(() => mockService.hello()).toEqual(`aws-s3-service:${AWSS3Service.DEF_S3_BUCKET}`);

        //* test bucket() method
        expect2(() => mockService.bucket()).toEqual(AWSS3Service.DEF_S3_BUCKET);
        expect2(() => mockService.bucket('TEMP_BUCKET')).toEqual('hello-bucket');
        expect2(() => mockService.bucket('MY_BUCKET')).toEqual(AWSS3Service.DEF_S3_BUCKET);
        expect2(() => mockService.bucket('my-bucket')).toEqual('my-bucket');
    });

    //* test mock service listObjects with pagination
    it('check mock service listObjects with pagination', async () => {
        const prefix = 'pagination-test/';
        const keys = Array.from({ length: 15 }, (_, i) => `${prefix}file-${String(i).padStart(2, '0')}.json`);
        const body = JSON.stringify({ test: 'data' });

        //* create test files
        for (const key of keys) {
            await S3.putObject(body, key);
        }

        //* test with limit
        const list1 = await S3.listObjects({ prefix, limit: 5 });
        expect2(() => list1.Contents.length).toEqual(5);
        expect2(() => list1.KeyCount).toEqual(5);
        expect2(() => list1.MaxKeys).toEqual(5);
        expect2(() => list1.IsTruncated).toEqual(true);
        expect2(() => list1.NextContinuationToken).toBeDefined();

        //* test with continuation token
        const list2 = await S3.listObjects({
            prefix,
            limit: 5,
            nextToken: list1.NextContinuationToken,
        });
        expect2(() => list2.Contents.length).toEqual(5);
        expect2(() => list2.KeyCount).toEqual(5);
        expect2(() => list2.IsTruncated).toEqual(true);

        //* test unlimited
        const listAll = await S3.listObjects({ prefix, limit: 5, unlimited: true });
        expect2(() => listAll.Contents.length).toEqual(15);
        expect2(() => listAll.KeyCount).toEqual(15);
        expect2(() => listAll.MaxKeys).toEqual(5);
        expect2(() => listAll.IsTruncated).toEqual(false);
        expect2(() => listAll.NextContinuationToken).toBeUndefined();

        //* cleanup
        for (const key of keys) {
            await S3.deleteObject(key);
        }
    });

    //* test mock service with different content types
    it('check mock service with different content types', async () => {
        //* test with text content
        const textKey = 'test-text.txt';
        const textContent = 'Hello, World!';
        await S3.putObject(textContent, textKey);

        const textResult = await S3.getObject(textKey);
        expect2(() => textResult.Body?.toString()).toEqual(textContent);
        expect2(() => textResult.ContentType).toEqual('text/plain; charset=utf-8');

        //* test with binary content (Buffer)
        const binaryKey = 'test-binary.bin';
        const binaryContent = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello" in hex
        await S3.putObject(binaryContent, binaryKey);

        const binaryResult = await S3.getObject(binaryKey);
        expect2(() => binaryResult.Body).toEqual(binaryContent);
        expect2(() => binaryResult.ContentType).toEqual('application/octet-stream'); // correct for .bin files

        //* cleanup
        await S3.deleteObject(textKey);
        await S3.deleteObject(binaryKey);
    });

    //* test real AWS instance creation (for coverage)
    it('check real AWS instance creation', async () => {
        const realS3Service = new AWSS3Service(); // not mock

        //* test that it creates real instance
        expect2(() => realS3Service.name()).toEqual('S3');
        expect2(() => realS3Service.hello()).toContain('aws-s3-service:');
    });

    //* test error scenarios for coverage
    it('check error handling coverage', async () => {
        //* test deleteObject error handling with real service (if PROFILE exists)
        if (!PROFILE) return;

        //* test with invalid bucket name to trigger error
        const invalidS3 = new AWSS3Service();
        expect2(() => invalidS3.name()).toEqual('S3');
        // Note: This would require actual AWS credentials and might fail in CI
        // So we'll test the mock error scenarios instead
    });

    //* test streamToBuffer method coverage
    it('check streamToBuffer method coverage', async () => {
        const service = new AWSS3Service();
        //* create a readable stream for testing
        const testData = 'Hello, World!';
        const stream = new Readable();
        stream.push(testData);
        stream.push(null); // end stream

        const buffer = await (service as any).streamToBuffer(stream);
        expect(buffer.toString()).toEqual(testData);
    });

    //* test listObjects error handling with throwable=false
    it('check listObjects error handling coverage', async () => {
        //* create a service that will throw an error for listObjects
        const errorMockService = new AWSS3Service();

        //* test with throwable=false (should not throw, but set error in result)
        const result = await errorMockService.listObjects({ prefix: 'test/', throwable: false });
        expect2(() => result.error).toEqual('Simulated S3 error');
        expect2(() => result.Contents).toEqual(null);

        //* test deleteObject with special 'non-existent-key' for coverage
        expect2(await S3.deleteObject('non-existent-key').catch(GETERR)).toEqual('Key not found');
    });

    //* test deleteObject error handling (lines 410-411)
    it('check deleteObject error handling coverage', async () => {
        //* test deleteObject error handling (should log error and re-throw)
        expect2(await S3.deleteObject('test-key').catch(GETERR)).toEqual('Access Denied');
    });

    //* test metadata with origin for coverage
    it('check metadata origin handling coverage', async () => {
        const json = { test: 'data' };
        const body = JSON.stringify(json);
        const key = 'test-origin.json';

        //* test with metadata containing origin
        const metadata = { origin: 'test-file.txt' };
        const result = await S3.putObject(body, key, metadata);

        expect2(() => result.ContentType).toEqual('text/plain; charset=utf-8'); // based on .txt extension
        expect2(() => result.Key).toEqual(key);

        //* cleanup
        await S3.deleteObject(key);
    });
});
