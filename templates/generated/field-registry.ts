// STUB for templates type-check ONLY — not generated, not consumed at runtime.
// Entries copied verbatim from lemon-templates-api src/generated/field-registry.ts.
// Do NOT edit values, do NOT run `lemon-fields gen` against this directory.
export const fieldKeys = {
    // source: src/cores/abstract-services.ts#CoreModel
    coreModel: <T extends object>() =>
        ["$", "ns", "type", "stereo", "sid", "uid", "gid", "lock", "next", "meta", "createdAt", "updatedAt", "deletedAt", "error", "id", "_id"] as Array<Extract<keyof T, string>>,
    // source: src/cores/abstract-services.spec.ts#TestModel
    testModel: <T extends object>() =>
        ["name", "test", "extra", "Model", "$identity", "$", "ns", "type", "stereo", "sid", "uid", "gid", "lock", "next", "meta", "createdAt", "updatedAt", "deletedAt", "error", "id", "_id"] as Array<Extract<keyof T, string>>,
} as const;
