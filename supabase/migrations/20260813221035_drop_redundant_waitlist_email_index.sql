-- A entity declarava @Index({ unique: true }) e @Column({ unique: true }) na
-- mesma coluna, entao a migration do TypeORM emitiu DOIS objetos unicos sobre
-- email: a constraint UQ_90cae6cb55d051291054d7e8d12 e o indice
-- IDX_90cae6cb55d051291054d7e8d1. Sao dois B-trees mantidos a cada insert, um
-- deles sem serventia.
--
-- A constraint fica (e o baseline acima ja a cria como `unique`); o indice
-- solto sai. Em banco novo isso e um no-op.

drop index if exists public."IDX_90cae6cb55d051291054d7e8d1";
