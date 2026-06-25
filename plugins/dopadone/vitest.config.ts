import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * The hooks import the domain math (phase/probability/agenda) from
 * `@dopadone/core/habits` (#283). The plugin has no node_modules of its own, so tests
 * resolve that specifier to core's pre-built, self-contained `dist/habits.mjs` (rrule
 * inlined via tsup `noExternal`) — same target the esbuild bundle aliases. Build core
 * first: `pnpm --filter @dopadone/core build`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@dopadone/core/habits': fileURLToPath(
        new URL('../../../dopadone/packages/core/dist/habits.mjs', import.meta.url)
      )
    }
  }
})
