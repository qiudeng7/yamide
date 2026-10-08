import eslint from "@eslint/js";
import vue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["dist/**", "android/**", "ios/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/essential"],
  {files:["test/**/*.cjs"],languageOptions:{globals:Object.fromEntries(["require","__dirname","process","console","setTimeout","document","innerWidth"].map(k=>[k,"readonly"]))},rules:{"@typescript-eslint/no-require-imports":"off"}},
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
      globals: Object.fromEntries(
        [
          "confirm",
          "HTMLDivElement",
          "WebSocket",
          "ResizeObserver",
          "setTimeout",
          "setInterval",
          "URL",
          "clearTimeout",
          "clearInterval",
        ].map((k) => [k, "readonly"]),
      ),
    },
  },
);
