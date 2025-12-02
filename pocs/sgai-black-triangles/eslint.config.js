// @ts-check

import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: ['.output/**', 'build/**', 'node_modules/**', 'styled-system/**'],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['*.config.*', '.ladle/**/*'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 0,
      '@typescript-eslint/no-unsafe-call': 0,
    },
  },
)
