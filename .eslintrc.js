module.exports = {
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:node/recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
    "prettier/@typescript-eslint",
    "plugin:prettier/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaFeatures: {
      modules: true,
    },
    ecmaVersion: 6,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint", "node", "prettier"],
  rules: {
    curly: ["error", "all"],
    "no-console": "error",
    "prettier/prettier": "error",
    "node/no-missing-import": "off",
    "node/no-unsupported-features/es-syntax": "off",
  },
};
