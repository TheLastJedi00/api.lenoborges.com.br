# Design da API
- MVC Simples
- Firestore pelo Admin SDK (`firebase-admin`) para persistência. Tipos e
  `FirestoreDataConverter` em `src/**/entities/`, acesso só pelos repositories.
- **Não há migrations e não há schema a versionar.** O Firestore não tem DDL. Em troca, o que o
  banco garantia passa a ser responsabilidade da aplicação: unicidade vira ID de documento,
  faixa de valor vira validação, e acesso direto vira `firestore.rules`. Ao mexer em estrutura
  de dado, pergunte qual garantia está sendo assumida pelo código — a spec 007 lista as que
  mudaram de lugar.
- **Repositories sempre devolvem objeto** (`{ found, entry }`, nunca `null` cru). Esta regra é a
  que fez a migração de Postgres para Firestore caber em duas classes: os services não sabiam o
  que tinha embaixo e continuaram sem saber. Vale a pena defendê-la.
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