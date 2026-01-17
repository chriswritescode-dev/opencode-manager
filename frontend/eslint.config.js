import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: {
          // Be more specific with allowed default projects
          allowDefaultProject: [],
          defaultProject: "./tsconfig.app.json"
        },
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}', 'src/components/message/FileToolRender.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Special rules for test files
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // Often needed for mocks
      '@typescript-eslint/no-empty-function': 'off', // Common in test setup
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
    }
  },
])
