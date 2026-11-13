import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/app.js',
  output: {
    file: 'public/js/bundle-app.js',
    format: 'iife',
    sourcemap: true
  },
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    terser()
  ]
};
