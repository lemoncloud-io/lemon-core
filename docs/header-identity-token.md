# IdentityToken

it describes the basic mechanism of `identity-token` in http header

**Overview**

1. make JWT Token w/ KMS Signing @backend-api
    - save KMS Key as issuer

1. send(or share) this Token to client, and save into local storage @client
    - `Token` will be available custome backend-api while register-device.

1. On every request, send Token by embedding header
    - default header-name is `X-Lemon-Identity`

1. In lambda web-handler, parse and verity Token by KMS Key.
    - token is Only valid if verified and not expired.


## Prepare KMS Key

Steps to make Key with alias

1. Open KMS (Key Management Service) in AWS Console

1. Go `Customer managed keys`, and select `Create Key`

    **[Step1: Configure Key]**
    - Key type: `Asymmetric`
    - Key usage: `Sign and verify`
    - Key spec: `RSA_2048`

    **[Step2: Add labels]**
    - Alias: `my-key-alias`

