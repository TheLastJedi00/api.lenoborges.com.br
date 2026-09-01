# Spec 023: Arena de Treinamento

## Objetivo
A Arena de Treinamento adiciona desafios práticos de código na jornada do membro. Localizada na trilha de estudos, entre a lista de vídeos e o GYM Challenge, a Arena oferece desafios baseados em passos a serem executados no código. Cada desafio concluído concede XP (padrão de 30XP). Além disso, os membros podem interagir e tirar dúvidas através de um sistema de comentários em cada desafio.

Do lado da administração, o admin pode gerenciar os treinamentos (título, descrição, passos, link de vídeo) diretamente na trilha correspondente, com suporte a ordenação, além de contar com um dashboard centralizado para gerenciar e responder aos comentários dos treinamentos.

O par desta spec no front é a **023**, e as duas entram juntas.

---

## Numeração
Os números são iguais nos dois repositórios, seguindo a ordem após a 022.

Esta spec depende da **009** (trilha, `badge_videos`), da **019** (XP) e da **021** (Respostas na Trilha). Nenhuma fase depende de spec posterior.

---

## Decisões

### 1. O Modelo do Treinamento
Os treinamentos pertencem a uma insígnia (trilha) e são ordenados manualmente pelo admin.
Coleção: `trainings`
Campos: `badgeId`, `title`, `description`, `steps` (array de strings), `videoUrl` (opcional), `xpAmount` (default 30), `position` (para ordenar na trilha), `createdAt`, `updatedAt`.

### 2. Comentários nos Treinamentos e Restrição de Tier
Cada treinamento possui uma subcoleção ou coleção raiz para os comentários.
Coleção: `training_comments`
Campos: `trainingId`, `uid`, `authorName`, `content`, `adminReply`, `createdAt`, `updatedAt`.

**A resposta do admin é um campo do próprio comentário**, e não um segundo documento:
`adminReply: { content, authorName, repliedAt } | null`, uma resposta por comentário, sobrescrita
se o admin responder de novo. A lista é plana por decisão, e um documento de resposta obrigaria a
listagem a costurar pai e filho em memória ou a pagar uma consulta por comentário. Como campo, a
resposta chega na mesma leitura que o modal do membro já faz: sem query nova, sem índice novo.
**Uma resposta que não volta para quem perguntou não é uma resposta** — sem este campo a rota de
reply gravaria no vazio, respondendo com sucesso e sem ninguém nunca ver.

**Restrição de Tier:** Apenas membros que possuem o **Great Tier** podem fazer comentários. A API deve validar o tier do membro logado na rota de `POST /trainings/:trainingId/comments` e retornar erro apropriado (ex: `403 Forbidden`) caso ele não seja do Great Tier.

**Estrutura:** Os comentários funcionam como uma lista plana simples (sem threads aninhadas), ordenados do mais recente para o mais antigo. A paginação retorna os últimos 10 comentários por padrão. 

### 3. Conclusão e Distribuição de XP
Os membros concluem um treinamento acionando explicitamente um endpoint (através do botão "Concluir Desafio" no Front).
Coleção de estado: `training_completions` (ou equivalente no progresso do membro). 
Quando o membro dispara a conclusão, o XP (`xpAmount`) é incrementado. O ganho de XP é concedido apenas uma vez por desafio. O membro pode rever o desafio depois de concluído.

### 4. Gestão do Admin e Central de Comentários
O admin tem CRUD completo dos treinamentos, acessado pela seção de gestão de trilha, com setas
para cima e para baixo ajustando a propriedade `position` — no molde exato do reorder de vídeos da
spec 009, com reordenação otimista em memória e rollback quando a API falha.

**Não é drag-and-drop**, e a troca é deliberada: o projeto não usa `@angular/cdk`, e no toque o
arrastar disputa com a rolagem da tela justamente na largura em que a maioria abre o painel. O
reorder chega ao servidor como a lista inteira de ids na ordem nova
(`PATCH /admin/badges/:badgeId/trainings/reorder`) e as posições são renormalizadas para `0..n-1`
dentro de um `WriteBatch` atômico. Uma atualização por item deixa dois treinamentos em
`position: 3` quando a segunda escrita falha, e essa lista fica errada em silêncio (spec 009).

**Excluir um treinamento apaga os comentários e as conclusões dele**, na mesma operação. É a sexta
vez que a regra vale: no Firestore nada some junto com o pai, e o que sobra fica invisível, cobrado
e impossível de achar depois.
O admin possui também uma visão agregada global: a rota de Comentários de Treinamentos permite não apenas visualizar, mas **responder diretamente** aos comentários nessa tela centralizada, otimizando o suporte (similar à funcionalidade do Mural de Perguntas).

---

## Endpoints — Resumo

### Admin
| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/admin/badges/:badgeId/trainings` | Lista os treinamentos de uma trilha |
| `POST` | `/admin/badges/:badgeId/trainings` | Cria um novo treinamento |
| `PATCH` | `/admin/trainings/:trainingId` | Edita o treinamento (inclui atualizar a posição) |
| `DELETE` | `/admin/trainings/:trainingId` | Exclui o treinamento, seus comentários e suas conclusões |
| `PATCH` | `/admin/badges/:badgeId/trainings/reorder` | Reordena a trilha (`{ orderedIds: string[] }`) |
| `GET` | `/admin/trainings/comments/recent` | Lista treinamentos com comentários recentes |
| `POST` | `/admin/trainings/comments/:commentId/reply` | Grava o `adminReply` no comentário |

### Membro
| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/badges/:badgeId/trainings` | Lista os treinamentos na trilha (com status de conclusão) |
| `GET` | `/trainings/:trainingId` | Detalhes do treinamento |
| `POST` | `/trainings/:trainingId/complete` | Marca o treinamento como concluído e ganha XP |
| `GET` | `/trainings/:trainingId/comments` | Lista os comentários (paginados, últimos 10) |
| `POST` | `/trainings/:trainingId/comments` | Adiciona um comentário (apenas Great Tier) |
