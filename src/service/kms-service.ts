/**
 * `kms-service.js`
 * - encrypt/decrypt service api with KMS
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

//! module name & namepsace
const name = 'KMS';
const NS = $U.NS(name, 'blue');

export interface CoreKmsService extends EnginePluggable {
    hello: () => { hello: string };
    encrypt: (message: string, keyId?: string) => Promise<string>;
    decrypt: (encryptedSecret: string) => Promise<string>;
}

/** ****************************************************************************************************************
 *  Public Instance Exported.
 ** ****************************************************************************************************************/
//TODO - load via environ.
const REGION = 'ap-northeast-2';

//! check if base64 string.
const isBase64 = (text: string) =>
    /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/.test(text);

//! get aws client for KMS
const instance = () => {
    const config = { region: REGION };
    return new AWS.KMS(config);
};

//! main service instance.
export const KMS = new (class implements CoreKmsService {
    public ENV_NAME = 'CORE_KMS_KEY';
    /**
     * get name of this
     */
    public name = () => `${name}`;

    /**
     * hello
     */
    public hello = () => ({ hello: 'kms-service' });

    /**
     * get key-id to encrypt.
     */
    public keyId = (target?: string) => {
        // if (!target) throw new Error('@target is required!');
        const env = $engine.environ(this.ENV_NAME, 'alias/lemon-hello-api') as string;
        return `${env || target}`;
    };

    /**
     * Encrypt message
     *
     * @param {*} message
     * @param {*} keyId
     */
    public encrypt = (message: string, keyId?: string): Promise<string> => {
        _inf(NS, `encrypt(${keyId})..`);
        const KeyId = this.keyId(keyId);
        const params = {
            KeyId,
            Plaintext: message,
        };
        return instance()
            .encrypt(params)
            .promise()
            .then(result => {
                _log(NS, '> result =', result);
                const ciphertext = result.CiphertextBlob ? result.CiphertextBlob.toString('base64') : message;
                _log(NS, '> ciphertext =', ciphertext.substring(0, 32), '...');
                return ciphertext;
            })
            .catch(e => {
                _err(NS, '! err=', e);
                throw e;
            });
    };

    /**
     * Decrypt message
     *
     * @param {*} encryptedSecret
     */
    public decrypt = (encryptedSecret: string): Promise<string> => {
        _inf(NS, `decrypt()..`);
        const CiphertextBlob =
            typeof encryptedSecret == 'string'
                ? isBase64(encryptedSecret)
                    ? Buffer.from(encryptedSecret, 'base64')
                    : encryptedSecret
                : encryptedSecret;
        //! api param.
        const params = { CiphertextBlob };
        return instance()
            .decrypt(params)
            .promise()
            .then(result => {
                // _log(NS, '> result =', result);
                return result.Plaintext ? result.Plaintext.toString() : '';
            })
            .catch(e => {
                _err(NS, '! err=', e);
                throw e;
            });
    };
})();
