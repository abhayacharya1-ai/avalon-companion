-- Avalon Companion: initial persistence schema.
-- Important: never create a table/column containing character roles or individual quest-card choices.
create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  host_token_hash text not null,
  phase text not null default 'lobby' check (phase in ('lobby','team','approval','quest','finished')),
  player_count int not null default 0 check (player_count between 0 and 10),
  current_quest int not null default 1 check (current_quest between 1 and 6),
  current_leader int not null default 0,
  rejection_count int not null default 0,
  public_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  display_name text not null,
  seat_index int not null,
  session_token_hash text not null,
  joined_at timestamptz not null default now(),
  unique(game_id, seat_index),
  unique(game_id, display_name)
);

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  quest_number int not null,
  proposal_number int not null,
  leader_player_id uuid not null references public.players(id),
  team_player_ids uuid[] not null,
  approval_count int,
  rejection_count int,
  outcome text check (outcome in ('approved','rejected')),
  revealed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(game_id, quest_number, proposal_number)
);

create table if not exists public.team_votes (
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  player_id uuid not null references public.players(id),
  choice text not null check (choice in ('approve','reject')),
  submitted_at timestamptz not null default now(),
  primary key(proposal_id, player_id)
);

-- Participation receipts are separate from quest ballot totals.
-- No per-player success/fail choice and no joinable ballot identifier is stored.
create table if not exists public.quest_participation (
  game_id uuid not null references public.games(id) on delete cascade,
  quest_number int not null,
  player_id uuid not null references public.players(id),
  submitted boolean not null default true,
  primary key(game_id, quest_number, player_id)
);

create table if not exists public.quest_results (
  game_id uuid not null references public.games(id) on delete cascade,
  quest_number int not null,
  team_player_ids uuid[] not null,
  success_count int not null,
  fail_count int not null,
  outcome text not null check (outcome in ('success','fail')),
  resolved_at timestamptz not null default now(),
  primary key(game_id, quest_number)
);

create table if not exists public.game_events (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  event_type text not null,
  public_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Production hardening:
-- 1) Enable RLS on every table.
-- 2) Revoke direct client writes to team_votes, quest_participation, quest_results and games.
-- 3) Route mutations through authenticated Edge Functions / SECURITY DEFINER RPCs that
--    validate session tokens, enforce phase transitions, and atomically resolve votes.
-- 4) Broadcast only public game state. Never broadcast raw quest ballot submissions.
-- 5) Do not store raw voice recordings or transcripts by default.
alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.proposals enable row level security;
alter table public.team_votes enable row level security;
alter table public.quest_participation enable row level security;
alter table public.quest_results enable row level security;
alter table public.game_events enable row level security;

-- No permissive policies are intentionally added here. Add narrowly scoped policies
-- after deploying the server-side RPC/Edge Function layer.
