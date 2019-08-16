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
import { $U, _log, _inf, _err } from '../core/engine';
import { EnginePluggable } from 'lemon-engine';
import { environ, region } from './';
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
//! check if base64 string.
const isBase64 = (text: string) =>
    /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/.test(text);

//! get aws client for KMS
const instance = async () => {
    const _region = await region();
    const config = { region: _region };
    return new AWS.KMS(config);
};

//! main service instance.
export const KMS = new (class implements CoreKmsService {
    public ENV_NAME = 'CORE_KMS_KEY';
    public DEF_TARGET = 'alias/lemon-hello-api';

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
    public keyId = async (target?: string) => {
        // if (!target) throw new Error('@target is required!');
        return environ(target, this.ENV_NAME, this.DEF_TARGET);
    };

    /**
     * Encrypt message
     *
     * @param {*} message
     * @param {*} keyId
     */
    public encrypt = async (message: string, keyId?: string): Promise<string> => {
        _inf(NS, `encrypt(${keyId})..`);
        const KeyId = await this.keyId(keyId);
        const params = {
            KeyId,
            Plaintext: message,
        };
        return instance()
            .then(_ => _.encrypt(params).promise())
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
    public decrypt = async (encryptedSecret: string): Promise<string> => {
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
            .then(_ => _.decrypt(params).promise())
            .then(data => {
                _log(NS, '> data.type =', typeof data);
                return data.Plaintext ? data.Plaintext.toString() : '';
            })
            .catch(e => {
                _err(NS, '! err=', e);
                throw e;
            });
    };
})();
