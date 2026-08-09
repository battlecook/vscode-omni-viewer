module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
  ],
  env: {
    node: true,
    jest: true,
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // The base rule is superseded by the @typescript-eslint version above, which
    // understands type-only imports, interfaces and overload signatures. Leaving
    // both on reports every unused binding twice.
    'no-unused-vars': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    // This extension parses legacy binary formats (.doc, .ppt, .hwp, ...) whose
    // records are delimited by control characters, so matching \x00, \x07 and
    // friends in a regex is the intent rather than a mistake.
    'no-control-regex': 'off',
  },
  ignorePatterns: ['out', 'dist', '**/*.d.ts'],
};
