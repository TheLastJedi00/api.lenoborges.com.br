# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

`eduleno-back` is a NestJS 11 backend on Firebase (spec 007, which replaced Supabase). Firestore holds business data (`waitlist_entries`, `profiles`); Firebase Auth handles identity. Both go through `firebase-admin` with a single service account, confined to `FirebaseService`. The project follows a simple MVC layout with modules, controllers, services, and repositories. Repositories always return objects `{ found, entry }`, never primitive `null` directly — that boundary is what let the Postgres-to-Firestore swap land in two classes without touching a service.

**There is no schema and no migrations.** Firestore has no DDL, so guarantees that used to live in the database now live in code, and they are easy to lose by accident:

- **Document IDs carry meaning.** `waitlist_entries/{normalized-email}` is how email uniqueness is enforced — Firestore has no `UNIQUE` constraint, and the document path is the only place it guarantees uniqueness. `profiles/{firebase-uid}` replaces the old FK to `auth.users`. Never switch these to auto-IDs plus a query.
- **`create()`, never `set()`** in the repositories: `set()` overwrites silently, and it is the `ALREADY_EXISTS` from `create()` that stands in for the Postgres `23505` unique violation.
- Value ranges (`grade` 0–13; see spec 008 (Liga Dev), which lives in the **front** repo — 1-8 are badges, 9-12 the Elite Four, 13 post-game) and required fields are validated in the application; `firestore.rules` denies everything, since only the Admin SDK — which bypasses rules — touches the data.
- **`badge_videos/{badgeId}__{youtubeId}`** (spec 009) is the same idea applied twice: the composite path is what keeps a video from entering the same badge twice, while still allowing it in a different badge. And `order` is **renormalized to 0..n-1 inside an atomic `WriteBatch`** on every reorder and delete — a per-video update leaves two videos on `order: 3` when the second write fails, and that list is wrong in silence.
- **The badge listing is the first query that is not by path**, so it needs a composite index (`badgeId` + `order`) in production. The emulator does not require indexes, so the suite stays green and the failure only shows up live.
- **`role` is a Firebase Auth custom claim, never a Firestore field** — it rides inside the ID token the guard already verifies. It takes effect only on the *next* token, up to an hour later (`CHECK_REVOKED = false`). Granting is `npm run admin:grant -- <email>`; there is no endpoint that creates an admin.
- **The Mural's weekly rollover is a computation, not a cron** (spec 010). Each question stores the `weekId` it was born in, and its phase is derived at read time from the server clock in `America/Sao_Paulo`. A cron that fails to run would freeze the board on last Sunday — silently, with no error, until a student notices. Never replace this with a scheduled job.
- **`tier` is a Firestore field while `role` is a claim**, and the difference is deliberate: tier changes often and must take effect immediately, while a claim would take up to an hour. `tier` is *access*; `grade` is *achievement* — neither derives from the other, in either direction.
- **Subcollections do not disappear with their parent** in Firestore. Deleting a mural question deletes its `votes` subcollection explicitly, or the votes are orphaned — invisible, billed, and unfindable.
- **`notifications/{video__badgeId__youtubeId | pergunta__questionId}`** (spec 012) is the same path-as-uniqueness rule again: a retried publish cannot announce the same video twice. Notifications are **global, one document per event — never fanned out per member**, and what is per-person is only what they have read, in `profiles/{uid}/notification_reads/{notificationId}`. That subcollection is the one place where **`set()` is right and `create()` would be wrong**: marking as read has two callers in the panel and must be idempotent. It is also a subcollection, so deleting a profile has to delete it explicitly — same trap as the mural votes.
- **Writing a notification never decides the fate of the thing it announces** (spec 012). The video is created, the question is written, and only then the notification goes out — outside the try that translates `ALREADY_EXISTS`, with a `catch` of its own at each trigger. That `catch` looks like carelessness and is the decision: a 500 there would lose the admin's work over an advisory. Failures log; they never surface.
- **Four queries need composite indexes in production** — two on `mural_questions` (week+votes+created, week+created) and two on `badge_videos` (badge+order, badge+kind+order). Note the pair on `badge_videos`: `kind` is optional in `listByBadge`, so badge+order is a real query and not a prefix of the other one. The emulator does not require indexes, so the suite stays green and the failure only shows up live. **The count belongs in the README table, not in this sentence** — it has already gone stale twice. See "Índices compostos que produção exige" in `README.md`.

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
npm run admin:grant -- <email>   # grants the admin claim (add --revoke to undo)
```

**The emulator needs Java on the PATH.** Without it, `npm run test:e2e` fails at startup with "Could not spawn `java -version`" and no test runs — the unit suite (`npm test`) is unaffected.

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
