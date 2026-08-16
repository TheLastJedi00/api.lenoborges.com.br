# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

`eduleno-back` is a NestJS 11 backend on Firebase (spec 007, which replaced Supabase). Firestore holds business data (`waitlist_entries`, `profiles`); Firebase Auth handles identity. Both go through `firebase-admin` with a single service account, confined to `FirebaseService`. The project follows a simple MVC layout with modules, controllers, services, and repositories. Repositories always return objects `{ found, entry }`, never primitive `null` directly — that boundary is what let the Postgres-to-Firestore swap land in two classes without touching a service.

**There is no schema and no migrations.** Firestore has no DDL, so guarantees that used to live in the database now live in code, and they are easy to lose by accident:

- **Document IDs carry meaning.** `waitlist_entries/{normalized-email}` is how email uniqueness is enforced — Firestore has no `UNIQUE` constraint, and the document path is the only place it guarantees uniqueness. `profiles/{firebase-uid}` replaces the old FK to `auth.users`. Never switch these to auto-IDs plus a query.
- **`create()`, never `set()`** in the repositories: `set()` overwrites silently, and it is the `ALREADY_EXISTS` from `create()` that stands in for the Postgres `23505` unique violation.
- Value ranges (`grade` 1–33) and required fields are validated in the application; `firestore.rules` denies everything, since only the Admin SDK — which bypasses rules — touches the data.

Login goes through the Identity Toolkit REST API from the server, not the Admin SDK, because the Admin SDK cannot verify passwords. **Password definition happens outside this API entirely**, on Firebase's hosted screen; there is no `POST /auth/password` and the `oobCode` never reaches this code.

## Commands

```bash
npm run start:dev        # watch-mode dev server (port from PORT env var, default 3000)
npm run build            # nest build -> dist/ (deleteOutDir is on)
npm run start:prod       # node dist/main
npm run lint             # eslint over {src,apps,libs,test}/**/*.ts, autofixes
npm run format           # prettier --write over src/ and test/

npm test                 # unit tests: jest, rootDir=src, matches *.spec.ts
npm run test:cov         # coverage -> ./coverage
npm run test:e2e         # e2e: boots the Firebase emulator, runs jest --config ./test/jest-e2e.json, tears it down

# Firebase (no migrations exist — Firestore has no schema)
npm run emulators        # Auth + Firestore emulators (needs the Firebase CLI)
npm run rules:deploy     # publishes firestore.rules to the linked project
```

The e2e suite runs against the emulator, never a real project. `firebase emulators:exec` sets `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` itself, but `FIREBASE_SERVICE_ACCOUNT_JSON` must still be present in `.env` — boot validation requires it even when the credential is never actually used against the emulator.

Run a single unit test file or case:

```bash
npm test -- app.controller.spec.ts
npm test -- -t "should return"
npm run test:e2e -- -t "/ (GET)"
```

Note the two Jest configs are separate: the inline config in `package.json` only sees `src/`, so e2e specs under `test/` will never run under `npm test`.

## Architecture

Standard Nest DI/module layout. New features follow the Nest convention of one directory per feature under `src/` containing `*.module.ts`, `*.controller.ts`, `*.service.ts`, and `*.repository.ts` (plus `dto/` and `entities/` as needed), with the feature module imported into `AppModule.imports`. `FirebaseModule` is `@Global()` and provides `FirebaseService` (Auth + Firestore) everywhere; it has to be global because `AuthModule` already imports the profile and waitlist modules, and those need Firestore — without it the dependency graph closes into a cycle.

`src/main.ts` is the only place global setup (validation pipes, CORS, Swagger, trust proxy) can be applied. Validation is strictly configured to throw on non-whitelisted properties.

## Conventions

- Prettier: single quotes, trailing commas everywhere. Prettier runs as an ESLint rule (`prettier/prettier: error`), so `npm run lint` fails on formatting violations.
- ESLint uses `recommendedTypeChecked` (type-aware). `no-explicit-any` is off; `no-floating-promises` and `no-unsafe-argument` are warnings only.
- TypeScript is deliberately loose: `strictNullChecks` on but `noImplicitAny` off and full `strict` off. Module resolution is `nodenext` with `target: ES2023`; decorator metadata is enabled (required for Nest DI).
- No path aliases are configured — use relative imports.
