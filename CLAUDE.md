# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

`eduleno-back` is a NestJS 11 backend. As of now the repository is still the unmodified `@nestjs/cli` starter (single `AppModule` / `AppController` / `AppService` returning "Hello World!"), so nearly all domain code is still to be written. The README is the stock NestJS README and carries no project-specific information.

## Commands

```bash
npm run start:dev        # watch-mode dev server (port from PORT env var, default 3000)
npm run build            # nest build -> dist/ (deleteOutDir is on)
npm run start:prod       # node dist/main
npm run lint             # eslint over {src,apps,libs,test}/**/*.ts, autofixes
npm run format           # prettier --write over src/ and test/

npm test                 # unit tests: jest, rootDir=src, matches *.spec.ts
npm run test:cov         # coverage -> ./coverage
npm run test:e2e         # e2e: jest --config ./test/jest-e2e.json, matches *.e2e-spec.ts at repo root
```

Run a single unit test file or case:

```bash
npm test -- app.controller.spec.ts
npm test -- -t "should return"
npm run test:e2e -- -t "/ (GET)"
```

Note the two Jest configs are separate: the inline config in `package.json` only sees `src/`, so e2e specs under `test/` will never run under `npm test`.

## Architecture

Standard Nest DI/module layout. New features should follow the Nest convention of one directory per feature under `src/` containing `*.module.ts`, `*.controller.ts`, `*.service.ts` (plus `dto/` and `entities/` as needed), with the feature module imported into `AppModule.imports`. `nest g resource <name>` scaffolds this and is wired up via `nest-cli.json`.

`src/main.ts` is the only place global setup (validation pipes, CORS, prefixes, Swagger) can be applied — it is currently bare, so anything of that kind must be added there deliberately.

## Conventions

- Prettier: single quotes, trailing commas everywhere. Prettier runs as an ESLint rule (`prettier/prettier: error`), so `npm run lint` fails on formatting violations.
- ESLint uses `recommendedTypeChecked` (type-aware). `no-explicit-any` is off; `no-floating-promises` and `no-unsafe-argument` are warnings only.
- TypeScript is deliberately loose: `strictNullChecks` on but `noImplicitAny` off and full `strict` off. Module resolution is `nodenext` with `target: ES2023`; decorator metadata is enabled (required for Nest DI).
- No path aliases are configured — use relative imports.
