import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/transforms.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
  // fflate is an optional peer dependency — never bundle it.
  external: ['fflate'],
});
