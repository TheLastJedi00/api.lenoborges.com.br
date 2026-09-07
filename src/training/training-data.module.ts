import { Module } from '@nestjs/common';
import { TrainingRepository } from './training.repository';
import { TrainingCommentRepository } from './training-comment.repository';
import { TrainingCompletionRepository } from './training-completion.repository';

/**
 * Os três repositórios da Arena, num módulo que **não importa nada**.
 *
 * E é por isso que ele existe. O caminho óbvio seria pendurar tudo no
 * `TrainingModule` e fazer o `ProfileModule` importá-lo -- a exclusão de conta
 * precisa apagar as conclusões e os comentários da pessoa. Só que o
 * `TrainingModule` importa o `ProfileModule` de volta, para ler o tier de quem
 * comenta, e isso fecha um ciclo **de arquivos**:
 *
 *     profile.module.ts -> training.module.ts -> profile.module.ts
 *
 * E ciclo de arquivo `forwardRef` não resolve: quando `profile.module.ts` ainda
 * está sendo avaliado, o `import` que o outro faz dele devolve `undefined`, e o
 * Nest morre no boot com `UndefinedModuleException`. **Nenhum teste unitário
 * pega isso**, porque nenhum deles monta o `AppModule` -- é exatamente o que
 * aconteceu na spec 019, e o remédio é o mesmo do `WatchedVideoModule` e do
 * `MemberDirectoryModule`: um módulo pequeno, sem `imports`, cortando o ciclo na
 * raiz em vez de escondê-lo atrás de um `forwardRef`.
 *
 * **`forwardRef` que existe por acidente de arrumação é dívida indistinguível
 * do `forwardRef` que existe por decisão.**
 *
 * Os três repositórios só dependem do `FirebaseService`, que é global.
 */
@Module({
  providers: [
    TrainingRepository,
    TrainingCommentRepository,
    TrainingCompletionRepository,
  ],
  exports: [
    TrainingRepository,
    TrainingCommentRepository,
    TrainingCompletionRepository,
  ],
})
export class TrainingDataModule {}
