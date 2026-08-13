-- Baseline da tabela da lista de espera (spec 004).
--
-- Este arquivo substitui as migrations do TypeORM que criaram e ajustaram a
-- tabela. Em um banco novo ele cria o schema inteiro. No banco que ja tinha as
-- migrations do TypeORM aplicadas, ele NAO deve ser executado: marque como
-- aplicado com
--   supabase migration repair --status applied 20260813221034
--
-- created_at e timestamptz de proposito: como timestamp sem fuso, o valor seria
-- gravado no fuso da sessao do banco e lido no fuso do processo Node, deslocando
-- o receivedAt que a API anuncia como UTC.

create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  name varchar not null,
  phone varchar not null,
  email varchar not null unique,
  consent boolean not null,
  created_at timestamptz not null default now()
);
