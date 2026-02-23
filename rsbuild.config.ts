import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: {
      index: './src/index.tsx',
    },
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
  html: {
    template: './index.html',
    favicon: './favicon-32x32.png',
  },
  server: {
    port: 3001,
    historyApiFallback: true,
  },
  output: {
    distPath: {
      root: 'dist',
    },
    filename: {
      js: '[name].js',
    },
    assetPrefix: '/landscaper/',
  },
});
