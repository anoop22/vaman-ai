# Vaman-AI Agent Rules

## Code Style
- TypeScript ESM, strict mode
- Tab indentation, 100 char line width
- Use biome for formatting: `npm run check`

## Git Rules
- Never use `git add -A` or `git add .`
- Stage specific files only
- Commit messages: `type(scope): description`

## Testing
- Run `npm test` before committing
- Colocated tests: `src/foo.ts` -> `test/foo.test.ts`

## Package Structure
Each package in `packages/` has: `src/`, `test/`, `package.json`, `tsconfig.json`
