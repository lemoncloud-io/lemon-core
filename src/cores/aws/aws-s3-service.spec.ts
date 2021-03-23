/**
 * `service/test.s3-service.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-16 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
const ENV_NAME = 'MY_S3_BUCKET';
const DEF_BUCKET = 'lemon-hello-www';

//! override environ.
process.env = Object.assign(process.env, {
    TEMP_BUCKET: 'hello-bucket',
});

//! load $engine, and prepare dummy handler
import { loadProfile } from '../../environ';
import { GETERR } from '../../common/test-helper';
import { AWSS3Service, PutObjectResult } from './aws-s3-service';
// import { credentials } from '../../tools';
// import { environ } from '../..';

const S3 = new AWSS3Service();

describe(`test AWSS3Service`, () => {
    //! use `env.PROFILE`
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE=', PROFILE);

    test('check name() function', async () => {
        expect(S3.name()).toEqual('S3');
    });

    test('check hello() function', async () => {
        expect(S3.hello()).toEqual(`aws-s3-service:${S3.bucket()}`);
    });

    test('check bucket() function', async () => {
        expect(AWSS3Service.ENV_S3_NAME).toEqual(ENV_NAME);
        expect(AWSS3Service.DEF_S3_BUCKET).toEqual(DEF_BUCKET);
        expect(S3.bucket()).toEqual(DEF_BUCKET);
        expect(S3.bucket('TEMP_BUCKET')).toEqual('hello-bucket');
        expect(S3.bucket('MY_BUCKET')).toEqual(DEF_BUCKET);
        expect(S3.bucket('my-bucket')).toEqual('my-bucket');
    });

    test('check headObject() function', async () => {
        if (!PROFILE) return;
        /* eslint-disable prettier/prettier */

        // if the objects not exists
        expect(await S3.headObject('invalid-file')).toBeNull();
        // if the objects exists
        const json = JSON.stringify({ hello: 'world', lemon: true });
        const { Location: fileName } = await S3.putObject(json, 'test.json');
        // expect(await S3.headObject('invalid-file').catch(GETERR)).toMatchObject({ ContentType: 'application/json; charset=utf-8', ContentLength: json.length });
        expect(await S3.headObject('invalid-file').catch(GETERR)).toEqual(null);
        await S3.deleteObject(fileName);

        /* eslint-enable prettier/prettier */
    });

    test('check putObject() function', async () => {
        if (!PROFILE) return;
        const json = { hello: 'world', lemon: true, name: '한글!' };
        const body = JSON.stringify(json);
        let res: PutObjectResult;
        /* eslint-disable prettier/prettier */

        // manual key
        res = await S3.putObject(body, 'sample.json');
        expect(res.Bucket).toEqual(DEF_BUCKET);
        expect(res.Key).toEqual('sample.json');
        expect(res.Location).toMatch(new RegExp(`^https:\/\/${DEF_BUCKET}\.s3\.ap-northeast-2.amazonaws.com\/${res.Key}`));
        expect(res.ContentType).toEqual('application/json; charset=utf-8');
        expect(res.ContentLength).toEqual(body.length + 4);  // +2 due to unicode for hangul
        expect(await S3.getObject(res.Key)).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            Body: Buffer.from(body),
        });
        await S3.deleteObject(res.Key);

        // automatic key
        res = await S3.putObject(body);
        expect(res.Bucket).toEqual(DEF_BUCKET);
        expect(res.Key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/);
        expect(res.Location).toMatch(new RegExp(`^https:\/\/${DEF_BUCKET}\.s3\.ap-northeast-2.amazonaws.com\/${res.Key}`));
        expect(res.ContentType).toEqual('application/json; charset=utf-8');
        expect(res.ContentLength).toEqual(body.length + 4); // +2 due to unicode for hangul
        expect(await S3.getObject(res.Key)).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            Body: Buffer.from(body),
        });
        await S3.deleteObject(res.Key);

        // check tags
        const tags = { company: 'lemoncloud', service: 'lemon-core' };
        res = await S3.putObject(body, 'sample.json', null, tags);
        expect(await S3.getObject(res.Key)).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            TagCount: 2,
        });
        expect(await S3.getObjectTagging(res.Key)).toMatchObject(tags);
        await S3.deleteObject(res.Key);

        /* eslint-enable prettier/prettier */
    });

    test('check getDecodedObject() function', async () => {
        if (!PROFILE) return;
        const fileName = 'sample.json';
        const data = { hello: 'world', lemon: true };

        await S3.putObject(JSON.stringify(data), fileName);
        expect(await S3.getDecodedObject(fileName)).toEqual(data);
        await S3.deleteObject(fileName);
    });
});
