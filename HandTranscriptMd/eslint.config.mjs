import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tsparser from "@typescript-eslint/parser";

export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				project: "./tsconfig.json",
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				window: "readonly",
				document: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				requestAnimationFrame: "readonly",
				cancelAnimationFrame: "readonly",
				performance: "readonly",
				console: "readonly",
				process: "readonly",
				Image: "readonly",
			},
		},
	},
]);
