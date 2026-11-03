import { types } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const INITIAL_STACK_FORMATTER = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace')?.value;
const NATIVE_STACK_GETTER = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get;
const ERROR_TYPES = new Map([
    [Error.prototype, 'Error'],
    [TypeError.prototype, 'TypeError'],
    [ReferenceError.prototype, 'ReferenceError'],
    [SyntaxError.prototype, 'SyntaxError'],
    [RangeError.prototype, 'RangeError'],
    [URIError.prototype, 'URIError'],
    [EvalError.prototype, 'EvalError'],
    [AggregateError.prototype, 'AggregateError'],
]);
const AWS_CODES = new Set([
    'AccessDenied',
    'AccessDeniedException',
    'UnauthorizedOperation',
    'ExpiredToken',
    'ExpiredTokenException',
    'InvalidClientTokenId',
    'UnrecognizedClientException',
    'SignatureDoesNotMatch',
    'RequestExpired',
    'ValidationError',
    'ValidationException',
    'ResourceNotFoundException',
    'ResourceNotFound',
    'NoSuchBucket',
    'NoSuchKey',
    'NoSuchEntity',
    'NoSuchEntityException',
    'NotFoundException',
    'Throttling',
    'ThrottlingException',
    'TooManyRequestsException',
    'RequestLimitExceeded',
    'ServiceUnavailable',
    'ServiceUnavailableException',
    'InternalFailure',
    'InternalError',
    'InvalidParameterException',
    'InvalidParameterValue',
    'InvalidParameterValueException',
]);
// Only operations used by the pinned migration source or wrapper STS preflight.
const AWS_OPERATIONS = new Set([
    'GetCallerIdentity',
    'DescribeStackResources',
    'DescribeStackResource',
    'DescribeStacks',
    'GetTemplate',
    'UpdateStack',
    'DeleteStack',
    'DescribeTable',
    'GetQueueUrl',
    'GetQueueAttributes',
    'GetTopicAttributes',
    'ListBuckets',
    'ListObjectsV2',
    'GetBucketWebsite',
    'GetBucketPolicy',
    'GetBucketTagging',
    'PutBucketTagging',
    'DescribeLogGroups',
    'GetFunctionConfiguration',
    'GetFunction',
    'ListEventSourceMappings',
    'GetResources',
    'GetStages',
    'GetRestApi',
    'GetMethod',
    'ListSubscriptions',
    'ListRuleNamesByTarget',
    'DescribeRule',
    'ListTargetsByRule',
    'TagResource',
    'TagQueue',
    'TagLogGroup',
    'PutObject',
    'DeleteObject',
    'DeleteObjects',
]);
const FIELDS = ['kind', 'errorType', 'awsCode', 'operation', 'sourceFile', 'line'];
const generic = kind => ({
    kind,
    errorType: 'other',
    awsCode: 'other',
    operation: 'other',
    sourceFile: 'other',
    line: null,
});
const record = value => value !== null && typeof value === 'object' && !types.isProxy(value) && !Array.isArray(value);
const descriptor = (value, field) =>
    value !== null && ['object', 'function'].includes(typeof value) && !types.isProxy(value)
        ? Object.getOwnPropertyDescriptor(value, field)
        : undefined;
const own = (value, field) => {
    const d = descriptor(value, field);
    return d && 'value' in d ? d.value : undefined;
};
const accessor = (value, field) => {
    const d = descriptor(value, field);
    return d && !('value' in d);
};

/** Rebuild a diagnostic using fixed vocabularies; never forward arbitrary fields or coerce values. */
export function validateDiagnostic(value) {
    try {
        if (!record(value) || Object.keys(value).some(key => !FIELDS.includes(key))) return generic('other');
        const kind = own(value, 'kind');
        const output = generic(['javascript', 'aws-cli', 'process'].includes(kind) ? kind : 'other');
        const errorType = own(value, 'errorType'),
            code = own(value, 'awsCode'),
            operation = own(value, 'operation');
        if (output.kind === 'javascript' && [...ERROR_TYPES.values()].includes(errorType)) output.errorType = errorType;
        if (output.kind === 'aws-cli' && AWS_CODES.has(code) && AWS_OPERATIONS.has(operation)) {
            output.awsCode = code;
            output.operation = operation;
        }
        const file = own(value, 'sourceFile'),
            line = own(value, 'line');
        if (['migrate.mjs', 'common.mjs'].includes(file) && Number.isInteger(line) && line >= 1 && line <= 100000) {
            output.sourceFile = file;
            output.line = line;
        }
        return output;
    } catch {
        return generic('other');
    }
}

/** Only data properties are examined. Raw error text remains inside this process. */
export function classifyMigrationError(error, { migrationFile } = {}) {
    try {
        if (!record(error)) return generic('other');
        const errorType = ERROR_TYPES.get(Object.getPrototypeOf(error));
        const result = generic(errorType ? 'javascript' : 'other');
        result.errorType = errorType ?? 'other';
        const stderr = own(error, 'stderr');
        if (typeof stderr === 'string') {
            const match =
                /^(?:aws: \[ERROR\]: )?An error occurred \(([A-Za-z0-9]{1,64})\) when calling the ([A-Za-z0-9]{1,64}) operation:/m.exec(
                    stderr.slice(0, 65536),
                );
            if (match && AWS_CODES.has(match[1]) && AWS_OPERATIONS.has(match[2])) {
                result.kind = 'aws-cli';
                result.errorType = 'other';
                result.awsCode = match[1];
                result.operation = match[2];
            }
        }
        // V8 may format an Error stack lazily. Avoid user name/message accessors and custom formatters.
        if (
            !accessor(error, 'name') &&
            !accessor(error, 'message') &&
            !accessor(Error, 'prepareStackTrace') &&
            own(Error, 'prepareStackTrace') === INITIAL_STACK_FORMATTER
        ) {
            const d = descriptor(error, 'stack');
            // Node 24 stores native stacks behind a shared built-in accessor. Never invoke a supplied getter.
            const safeFields = ['name', 'message'].every(field => {
                let current = error;
                for (let depth = 0; current && depth < 4; depth++, current = Object.getPrototypeOf(current)) {
                    if (types.isProxy(current)) return false;
                    const value = descriptor(current, field);
                    if (value)
                        return 'value' in value && (value.value === undefined || typeof value.value === 'string');
                }
                return true;
            });
            const stack =
                d && 'value' in d
                    ? d.value
                    : errorType && safeFields && d?.get === NATIVE_STACK_GETTER && NATIVE_STACK_GETTER
                    ? Reflect.apply(NATIVE_STACK_GETTER, error, [])
                    : undefined;
            if (
                typeof stack === 'string' &&
                typeof migrationFile === 'string' &&
                path.basename(migrationFile) === 'migrate.mjs'
            ) {
                const files = [
                    ['migrate.mjs', path.resolve(migrationFile)],
                    ['common.mjs', path.resolve(path.dirname(migrationFile), '../agt/common.mjs')],
                ];
                for (const frame of stack.slice(0, 65536).split('\n').slice(1, 40)) {
                    let found = false;
                    for (const [sourceFile, file] of files) {
                        for (const expected of [file, pathToFileURL(file).href]) {
                            const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const match = new RegExp(
                                `^\\s+at (?:[^\\r\\n]*\\()?${escaped}:(\\d{1,6}):\\d{1,6}\\)?$`,
                            ).exec(frame);
                            const line = match ? Number(match[1]) : 0;
                            if (line >= 1 && line <= 100000) {
                                result.sourceFile = sourceFile;
                                result.line = line;
                                found = true;
                                break;
                            }
                        }
                        if (found) break;
                    }
                    if (found) break;
                }
            }
        }
        return validateDiagnostic(result);
    } catch {
        return generic('other');
    }
}

/** IPC is an untrusted boundary even when the worker is local. */
export function diagnosticFromMessage(message) {
    try {
        return validateDiagnostic(own(message, 'diagnostic'));
    } catch {
        return generic('other');
    }
}
