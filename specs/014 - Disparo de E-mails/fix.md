# Fix — `UndefinedModuleException` no `NotificationsModule`

**Data:** 2026-08-25  
**Erro:** `UndefinedModuleException` — módulo no índice `[0]` do array `imports` do `NotificationsModule` é `undefined`  
**Scope reportado:** `AppModule → ProfileModule → AuthModule → ProfileModule → MuralModule`

---

## 1. Diagnóstico

O Nest percorre a árvore de módulos em profundidade. Quando chega no
`NotificationsModule`, ele tenta resolver `imports[0]` — que é `ProfileModule`
importado **diretamente, sem `forwardRef`** — mas `ProfileModule` ainda está
em resolução (é o módulo que originou a cadeia). O resultado: `undefined`.

---

## 2. Cadeia circular encontrada

```
ProfileModule ──forwardRef──▸ MuralModule ──direto──▸ NotificationsModule ──direto──▸ ProfileModule
       ▲                                                                                │
       └────────────────────────────────────────────────────────────────────────────────┘
```

| Módulo | Importa | Tipo de import |
|---|---|---|
| [`profile.module.ts`](file:///C:/Users/Leno/Documents/Projects/edu-leno-borges/eduleno-back/src/profile/profile.module.ts) | `AuthModule`, `MuralModule` | ambos com `forwardRef` ✅ |
| [`auth.module.ts`](file:///C:/Users/Leno/Documents/Projects/edu-leno-borges/eduleno-back/src/auth/auth.module.ts) | `ProfileModule` | `forwardRef` ✅ |
| [`mural.module.ts`](file:///C:/Users/Leno/Documents/Projects/edu-leno-borges/eduleno-back/src/mural/mural.module.ts) | `ProfileModule`, `NotificationsModule` | `ProfileModule` com `forwardRef` ✅, **`NotificationsModule` direto** ⚠️ |
| [`notifications.module.ts`](file:///C:/Users/Leno/Documents/Projects/edu-leno-borges/eduleno-back/src/notifications/notifications.module.ts) | `ProfileModule` | **direto — sem `forwardRef`** ❌ |

O `forwardRef` está presente em dois dos três elos do ciclo (`ProfileModule ↔ MuralModule`),
mas o terceiro elo (`NotificationsModule → ProfileModule`) não tem, e é por aí que o Nest quebra.

---

## 3. Caminho da resolução que explode

```
AppModule
 └─▸ ProfileModule          ← começa a resolver, ainda não finalizou
      └─▸ AuthModule         (forwardRef — OK, adia)
      └─▸ MuralModule        (forwardRef — OK, adia)
           └─▸ ProfileModule  (forwardRef — OK, adia)
           └─▸ NotificationsModule
                └─▸ ProfileModule   ← import direto; ProfileModule ainda não terminou
                                      → resolve para undefined → 💥
```

---

## 4. Correção necessária

### 4.1. `notifications.module.ts` — usar `forwardRef` no `ProfileModule` (obrigatório)

```diff
-import { Module } from '@nestjs/common';
+import { forwardRef, Module } from '@nestjs/common';
 import { NotificationRepository } from './notification.repository';
 import { NotificationReadRepository } from './notification-read.repository';
 import { NotificationsService } from './notifications.service';
 import { NotificationsController } from './notifications.controller';
 import { ProfileModule } from '../profile/profile.module';

 @Module({
-  imports: [ProfileModule],
+  imports: [forwardRef(() => ProfileModule)],
   controllers: [NotificationsController],
   providers: [
     NotificationRepository,
     NotificationReadRepository,
     NotificationsService,
   ],
   exports: [NotificationsService],
 })
 export class NotificationsModule {}
```

### 4.2. `mural.module.ts` — usar `forwardRef` no `NotificationsModule` (recomendado)

O `MuralModule` já usa `forwardRef` para o `ProfileModule`, mas importa
`NotificationsModule` diretamente. Hoje funciona porque o Nest resolve
`NotificationsModule` antes de chegar nele, mas se a ordem de resolução
mudar (novo import, nova versão do NestJS), o mesmo `undefined` pode
reaparecer neste ponto. O import preventivo:

```diff
 import { NotificationsModule } from '../notifications/notifications.module';

 @Module({
-  imports: [forwardRef(() => ProfileModule), NotificationsModule],
+  imports: [forwardRef(() => ProfileModule), forwardRef(() => NotificationsModule)],
   ...
 })
```

---

## 5. Módulos fora do ciclo (verificados, sem ação)

| Módulo | Importa `ProfileModule` | Risco |
|---|---|---|
| [`admin.module.ts`](file:///C:/Users/Leno/Documents/Projects/edu-leno-borges/eduleno-back/src/admin/admin.module.ts) | direto | Nenhum — não faz parte de nenhum ciclo |
| [`billing.module.ts`](file:///C:/Users/Leno/Documents/Projects/edu-leno-borges/eduleno-back/src/billing/billing.module.ts) | direto | Nenhum |
| [`emails.module.ts`](file:///C:/Users/Leno/Documents/Projects/edu-leno-borges/eduleno-back/src/emails/emails.module.ts) | direto | Nenhum — `EmailsModule` não é importado por nenhum módulo do ciclo |
| [`track.module.ts`](file:///C:/Users/Leno/Documents/Projects/edu-leno-borges/eduleno-back/src/track/track.module.ts) | importa `NotificationsModule` direto | Nenhum — `TrackModule` não é importado pelo `ProfileModule` nem pelo `MuralModule` |

---

## 6. Resumo

| # | Ação | Arquivo | Prioridade |
|---|---|---|---|
| 1 | Trocar `ProfileModule` por `forwardRef(() => ProfileModule)` | `src/notifications/notifications.module.ts` | **Crítica — corrige o crash** |
| 2 | Trocar `NotificationsModule` por `forwardRef(() => NotificationsModule)` | `src/mural/mural.module.ts` | Preventiva |
