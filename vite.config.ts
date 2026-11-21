import { defineConfig } from 'vite';

// GitHub Pages のサブパス公開用。リポジトリ名に合わせて変更してください。
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
});
