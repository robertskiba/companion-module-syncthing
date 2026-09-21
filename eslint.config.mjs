import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

export default [
	...(await generateEslintConfig({
		enableTypescript: true,
	})),
	{
		// The test scripts are development tools: they run the built output directly and
		// report their result through the exit code, which the shipped module never does.
		files: ['tests/**/*.mjs'],
		rules: {
			'n/no-unpublished-import': 'off',
			'n/no-process-exit': 'off',
		},
	},
]
