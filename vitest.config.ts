// Vitest configuration for Node-based test execution.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    // Legacy TS decorators (`@field()`) for spec files: tsconfig.json excludes `*.spec.ts`, so vite's oxc
    // transform does not inherit `experimentalDecorators` for them (vite >= 8.3 left `@field()` untransformed).
    oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
    test: {
        globals: true,
        environment: 'node',
        // v5 B10-5: `bin/**/*.spec.mjs` covers the `lemon-fields-types` CLI (plain ESM, no transform needed).
        include: ['src/**/*.spec.ts', 'bin/**/*.spec.mjs'],
        fileParallelism: false,
        clearMocks: true,
        coverage: {
            enabled: true,
            provider: 'v8',
            reporter: ['text', 'html'],
            reportsDirectory: 'coverage',
        },
    },
});
