# aws-lambda-helper 실행 예제

`src/tools/aws-lambda-helper.example.ts`는 `invokeLambda()`의 실제 호출 입력과 응답 변환을 확인하기 위한 실행 스크립트입니다.

기본 실행:

```sh
npx ts-node src/tools/aws-lambda-helper.example.ts
```

Lambda 대상, profile, region 지정:

```sh
npx ts-node src/tools/aws-lambda-helper.example.ts --target lemon-hello-api-dev-lambda --profile lemon --region ap-northeast-2
```

비동기 Lambda 호출:

```sh
npx ts-node src/tools/aws-lambda-helper.example.ts --target lemon-hello-api-dev-lambda --use-event
```

payload 지정:

```sh
npx ts-node src/tools/aws-lambda-helper.example.ts --payload-file ./data/samples/events/sample.event.web.api.json
npx ts-node src/tools/aws-lambda-helper.example.ts --payload-json '{"httpMethod":"GET","path":"/hello"}'
npx ts-node src/tools/aws-lambda-helper.example.ts --raw-payload '{"ping":"pong"}'
```

도움말:

```sh
npx ts-node src/tools/aws-lambda-helper.example.ts --help
```

기본값은 예제 파일의 `DEFAULT_ARGS`에서 조정할 수 있습니다.
