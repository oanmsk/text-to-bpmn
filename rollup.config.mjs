import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import bpmnlint from 'rollup-plugin-bpmnlint';

export default {
  input: 'src/app.js',
  output: {
    file: 'public/js/bundle-app.js',
    format: 'iife',
    name: 'App'
  },
  plugins: [
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    bpmnlint({ /* конфигурация линтера */ }),
    terser()
  ]
};
