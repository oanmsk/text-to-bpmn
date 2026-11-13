import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/app.js', // Путь к главному файлу фронтенда
  output: {
    file: 'public/js/bundle-app.js', // Куда сохранять готовый файл
    format: 'iife',
    sourcemap: true
  },
  plugins: [
    resolve({
      browser: true
    }),
    commonjs(),
    terser()
  ]
};
