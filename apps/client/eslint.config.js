import eslint from '@eslint/js'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  { languageOptions: { globals: { fetch: 'readonly' } } },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/essential'],
)
