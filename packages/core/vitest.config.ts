import { defineConfig } from 'vitest/config';

// 스펙 §12: core·server 라인 커버리지 90%. 클라 라우터·컴포넌트는 Playwright(E2E)로 검증한다
const SERVER_SIDE_LINES = 90;

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      include: ['src/**'],
      reporter: ['text-summary'],
      thresholds: {
        'src/core/**': { lines: SERVER_SIDE_LINES },
        'src/server/**': { lines: SERVER_SIDE_LINES },
      },
    },
  },
});
