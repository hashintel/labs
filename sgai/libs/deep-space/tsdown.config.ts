import { defineConfig } from 'tsdown'
import pluginBabel from '@rollup/plugin-babel'

export default defineConfig({
  platform: 'neutral',
  plugins: [
    pluginBabel({
      babelHelpers: 'bundled',
      parserOpts: {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      },
      plugins: ['babel-plugin-react-compiler'],
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    }),
  ],
})
