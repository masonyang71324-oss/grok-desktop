const globals = require('globals');
module.exports = [
  {
    files: ['electron/**/*.cjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-unsafe-finally': 'error',
      'no-constant-binary-expression': 'error',
      'valid-typeof': 'error',
      'use-isnan': 'error',
    },
  },
];
