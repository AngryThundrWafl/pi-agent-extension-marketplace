import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      ".pi/**",
      "templates/**",
      "coverage/**",
    ],
  },
  {
    files: ["**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["packages/**/*.ts"],
  })),
  {
    files: ["packages/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@sinclair/typebox",
              message: "Use 'typebox' instead of legacy '@sinclair/typebox'.",
            },
            {
              name: "@earendil-works/pi-ai",
              importNames: ["Type", "Static", "TSchema"],
              message: "Import Type, Static, and TSchema from 'typebox', not '@earendil-works/pi-ai'.",
            },
            {
              name: "@earendil-works/pi-coding-agent",
              importNames: ["keyHint", "keyText"],
              message: "Do not import keyHint or keyText from '@earendil-works/pi-coding-agent'.",
            },
          ],
          patterns: [
            {
              group: ["@mariozechner/*"],
              message: "Use @earendil-works/pi-* instead of legacy @mariozechner/* packages.",
            },
            {
              group: ["../../*"],
              message: "Relative imports starting with '../../' are forbidden to prevent cross-package escapes.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='Type'][callee.property.name='Union']:has(ArrayExpression > CallExpression[callee.object.name='Type'][callee.property.name='Literal'])",
          message: "Use StringEnum from '@earendil-works/pi-ai' instead of Type.Union([Type.Literal(...)]).",
        },
      ],
    },
  },
];
