# Design da API
- MVC Simples
- TypeORM para entidades, repositories e consultas
- Migrations são do Supabase, não do TypeORM: o schema vive em `supabase/migrations/*.sql` e é
  aplicado por `supabase db push` (ou pela integração do Supabase com o GitHub). O TypeORM roda
  sempre com `synchronize: false` e não gera nem aplica migration. Um `git push` não altera o
  banco por si só: o passo do Supabase é explícito.
- Repositories sempre devolvem objeto
- Documentar endpointes e estruturas de dados no [Read Me]("../../../README.md")
- Alterações em estrutura de dados devem marcar specs anteriores que montaram essa table com Deprecated e referenciá-las na spec atual

# Fluxo de Trabalho
1. Ler context.md da spec
2. Aperfeicoar o context.md com mais informação necessária pra levantar a spec
3. Criar um tasks.md divido em fases e fases divididas em tasks atômicas citando os arquivos a serem alterados e objetivo da alteração.
4. Se, somente se, for usado o comando "executar", iniciar a execução das tasks imediatamente após criá-las
5. Se, somente se, no meio da execução de uma spec aparecer alguma alteração de escopo por necessidade pra completar a task, destacar no topo do context.md
6. Usar TDD, criar testes antes da lógica dos services

# Exemplo de tasks.md
```
    # Fase 01:<Título> []
    - [] Tasks 01:<Nome/Objetivo> 
```
- Marcar com [x] tasks e fases concluídas

# Versionamento
1. Abrir uma branch feat/ para cada fase sendo cada task um commit
2. Cada fase é um push
3. Ao fim da spec abrir uma branch release/ unindo todas as feat/ da spec
4. Merge em dev a release
5. PR contra a main (se houver origin, se não, merge de dev contra main local)