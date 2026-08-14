-- Tabela de perfis dos membros (spec 005).
--
-- id e igual a auth.users(id) com FK cascade.
-- waitlist_entry_id vincula a inscricao na lista de espera caso exista.
-- grade e smallint de 1 a 33 (Grau 1 por padrao).
-- completed_at marca quando o onboarding foi preenchido.
-- RLS habilitada sem policies para bloquear acesso direto via PostgREST/anon key.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  phone text,
  bio text,
  grade smallint not null default 1 check (grade between 1 and 33),
  completed_at timestamptz,
  waitlist_entry_id uuid references public.waitlist_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS ligada sem policy fecha a tabela para PostgREST e chave anon
alter table public.profiles enable row level security;
