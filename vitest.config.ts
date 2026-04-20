// Vitest configuration for Node-based test execution.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts'],
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
