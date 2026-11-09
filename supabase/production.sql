-- Avalon Companion secure multiplayer backend
-- Run this entire file in Supabase SQL Editor after creating the project.
-- No roles are stored. Individual quest-card choices are NEVER persisted.

create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  phase text not null default 'lobby' check (phase in ('lobby','team','approval','quest','finished')),
  player_count int not null default 0 check (player_count between 0 and 10),
  current_quest int not null default 1 check (current_quest between 1 and 6),
  current_leader int not null default 0,
  rejection_count int not null default 0,
  public_state jsonb not null default '{}'::jsonb,
  quest_success_count int not null default 0,
  quest_fail_count int not null default 0,
  created_at timestamptz not null default now()
);

-- The earlier starter schema included this host-only hash column; it is obsolete now.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='games' and column_name='host_token_hash') then
    alter table public.games alter column host_token_hash drop not null;
  end if;
end $$;

alter table public.games add column if not exists quest_success_count int not null default 0;
alter table public.games add column if not exists quest_fail_count int not null default 0;

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

alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.proposals enable row level security;
alter table public.team_votes enable row level security;
alter table public.quest_participation enable row level security;
alter table public.quest_results enable row level security;
alter table public.game_events enable row level security;

-- Remove any broad policies if this script is rerun. All game access is through RPCs.
drop policy if exists "public read games" on public.games;
drop policy if exists "public read players" on public.players;
drop policy if exists "public read proposals" on public.proposals;
drop policy if exists "public read votes" on public.team_votes;
revoke all on public.games, public.players, public.proposals, public.team_votes,
  public.quest_participation, public.quest_results, public.game_events from anon, authenticated;

create or replace function public.avalon_team_size(p_players int, p_quest int)
returns int language sql immutable as $$
  select case p_players
    when 5 then (array[2,3,2,3,3])[p_quest]
    when 6 then (array[2,3,4,3,4])[p_quest]
    when 7 then (array[2,3,3,4,4])[p_quest]
    when 8 then (array[3,4,4,5,5])[p_quest]
    when 9 then (array[3,4,4,5,5])[p_quest]
    when 10 then (array[3,4,4,5,5])[p_quest]
    else null end;
$$;

create or replace function public.avalon_auth_player(p_token text)
returns table(game_id uuid, player_id uuid, seat_index int, display_name text)
language sql security definer set search_path = public, extensions as $$
  select p.game_id, p.id, p.seat_index, p.display_name
  from public.players p
  where p.session_token_hash = encode(digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
  limit 1;
$$;

create or replace function public.avalon_create_room(p_display_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name text := trim(regexp_replace(coalesce(p_display_name,''), '\s+', ' ', 'g'));
  v_code text;
  v_game_id uuid;
  v_player_id uuid := gen_random_uuid();
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_state jsonb;
begin
  if length(v_name) < 1 or length(v_name) > 28 then raise exception 'Enter a name between 1 and 28 characters.'; end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 6));
    exit when not exists(select 1 from public.games where room_code = v_code);
  end loop;
  insert into public.games(room_code, player_count, public_state)
  values(v_code, 1, '{}'::jsonb) returning id into v_game_id;
  insert into public.players(id, game_id, display_name, seat_index, session_token_hash)
  values(v_player_id, v_game_id, v_name, 0, encode(digest(convert_to(v_token,'UTF8'),'sha256'),'hex'));
  v_state := jsonb_build_object(
    'code',v_code,'players',jsonb_build_array(jsonb_build_object('id',v_player_id,'name',v_name,'joined',true)),
    'hostId',v_player_id,'phase','lobby','quest',1,'leader',0,'team','[]'::jsonb,
    'proposals','[]'::jsonb,'currentVotes','[]'::jsonb,'questSubmittedCount',0,
    'questSuccess',0,'questFail',0,'history','[]'::jsonb,
    'events',jsonb_build_array(jsonb_build_object('title','Room created','detail',v_name||' created the room.','time',to_char(now(),'HH12:MI AM'))),
    'rejects',0,'votesRevealed',false
  );
  update public.games set public_state=v_state where id=v_game_id;
  return jsonb_build_object('sessionToken',v_token,'playerId',v_player_id,'state',v_state);
end; $$;

create or replace function public.avalon_join_room(p_room_code text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_game public.games%rowtype;
  v_name text := trim(regexp_replace(coalesce(p_display_name,''), '\s+', ' ', 'g'));
  v_player_id uuid := gen_random_uuid();
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_state jsonb;
  v_players jsonb;
begin
  select * into v_game from public.games where room_code=upper(trim(p_room_code)) for update;
  if not found then raise exception 'Room not found. Check the code.'; end if;
  if v_game.phase <> 'lobby' then raise exception 'This game has already started.'; end if;
  if v_game.player_count >= 10 then raise exception 'This room is full.'; end if;
  if length(v_name)<1 or length(v_name)>28 then raise exception 'Enter a name between 1 and 28 characters.'; end if;
  if exists(select 1 from public.players where game_id=v_game.id and lower(display_name)=lower(v_name)) then raise exception 'That name is already in this room.'; end if;
  insert into public.players(id,game_id,display_name,seat_index,session_token_hash)
  values(v_player_id,v_game.id,v_name,v_game.player_count,encode(digest(convert_to(v_token,'UTF8'),'sha256'),'hex'));
  v_players := coalesce(v_game.public_state->'players','[]'::jsonb) || jsonb_build_array(jsonb_build_object('id',v_player_id,'name',v_name,'joined',true));
  v_state := jsonb_set(v_game.public_state,'{players}',v_players,true);
  v_state := jsonb_set(v_state,'{events}',coalesce(v_state->'events','[]'::jsonb) || jsonb_build_array(jsonb_build_object('title','Player joined','detail',v_name||' joined the room.','time',to_char(now(),'HH12:MI AM'))),true);
  update public.games set player_count=player_count+1, public_state=v_state where id=v_game.id;
  return jsonb_build_object('sessionToken',v_token,'playerId',v_player_id,'state',v_state);
end; $$;

create or replace function public.avalon_get_state(p_session_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_auth record; v_game public.games%rowtype; v_state jsonb;
begin
  select * into v_auth from public.avalon_auth_player(p_session_token);
  if not found then raise exception 'Invalid player session.'; end if;
  select * into v_game from public.games where id=v_auth.game_id;
  v_state := v_game.public_state;
  -- Never expose individual quest participation identities or partial ballot totals.
  if v_game.phase='quest' then
    v_state := jsonb_set(v_state,'{questSubmittedCount}',to_jsonb((select count(*) from public.quest_participation where game_id=v_game.id and quest_number=v_game.current_quest)),true);
    v_state := jsonb_set(v_state,'{questSuccess}',to_jsonb(0),true);
    v_state := jsonb_set(v_state,'{questFail}',to_jsonb(0),true);
  end if;
  return jsonb_build_object(
    'state',v_state,
    'playerId',v_auth.player_id,
    'myQuestSubmitted',exists(select 1 from public.quest_participation qp where qp.game_id=v_game.id and qp.quest_number=v_game.current_quest and qp.player_id=v_auth.player_id),
    'myTeamVoteSubmitted',exists(select 1 from public.proposals pr join public.team_votes tv on tv.proposal_id=pr.id where pr.game_id=v_game.id and pr.quest_number=v_game.current_quest and pr.proposal_number=(select max(proposal_number) from public.proposals where game_id=v_game.id and quest_number=v_game.current_quest) and tv.player_id=v_auth.player_id),
    'teamVoteCount',(select count(*) from public.proposals pr join public.team_votes tv on tv.proposal_id=pr.id where pr.game_id=v_game.id and pr.quest_number=v_game.current_quest and pr.proposal_number=(select max(proposal_number) from public.proposals where game_id=v_game.id and quest_number=v_game.current_quest))
  );
end; $$;

create or replace function public.avalon_start_game(p_session_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_auth record; v_game public.games%rowtype; v_state jsonb;
begin
  select * into v_auth from public.avalon_auth_player(p_session_token);
  if not found then raise exception 'Invalid player session.'; end if;
  select * into v_game from public.games where id=v_auth.game_id for update;
  if v_auth.seat_index<>0 then raise exception 'Only the room creator can start the game.'; end if;
  if v_game.phase<>'lobby' or v_game.player_count<5 then raise exception 'The game needs 5–10 players and must be in the lobby.'; end if;
  v_state := jsonb_set(v_game.public_state,'{phase}','"team"'::jsonb,true);
  v_state := jsonb_set(v_state,'{events}',v_state->'events' || jsonb_build_array(jsonb_build_object('title','Game started','detail',v_game.player_count||' players. Quest 1 begins.','time',to_char(now(),'HH12:MI AM'))),true);
  update public.games set phase='team',public_state=v_state where id=v_game.id;
  return v_state;
end; $$;

create or replace function public.avalon_propose_team(p_session_token text, p_player_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_auth record; v_game public.games%rowtype; v_state jsonb; v_team jsonb; v_proposal_id uuid := gen_random_uuid(); v_required int; v_num int; v_team_names text;
begin
  select * into v_auth from public.avalon_auth_player(p_session_token);
  if not found then raise exception 'Invalid player session.'; end if;
  select * into v_game from public.games where id=v_auth.game_id for update;
  if v_game.phase<>'team' then raise exception 'It is not the team nomination phase.'; end if;
  if v_auth.seat_index<>v_game.current_leader then raise exception 'Only the current leader can nominate a team.'; end if;
  v_required := public.avalon_team_size(v_game.player_count,v_game.current_quest);
  if coalesce(array_length(p_player_ids,1),0)<>v_required or (select count(distinct x) from unnest(p_player_ids) x)<>v_required then raise exception 'Select exactly % unique players.',v_required; end if;
  if exists(select 1 from unnest(p_player_ids) x where not exists(select 1 from public.players p where p.id=x and p.game_id=v_game.id)) then raise exception 'Team contains a player outside this room.'; end if;
  v_num := jsonb_array_length(v_game.public_state->'proposals')+1;
  insert into public.proposals(id,game_id,quest_number,proposal_number,leader_player_id,team_player_ids)
  values(v_proposal_id,v_game.id,v_game.current_quest,v_num,v_auth.player_id,p_player_ids);
  select string_agg(display_name,', ' order by seat_index) into v_team_names from public.players where id=any(p_player_ids);
  v_team := to_jsonb(p_player_ids);
  v_state := jsonb_set(v_game.public_state,'{phase}','"approval"'::jsonb,true);
  v_state := jsonb_set(v_state,'{team}',v_team,true);
  v_state := jsonb_set(v_state,'{currentVotes}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{votesRevealed}','false'::jsonb,true);
  v_state := jsonb_set(v_state,'{proposals}',v_game.public_state->'proposals' || jsonb_build_array(jsonb_build_object('id',v_proposal_id,'leaderId',v_auth.player_id,'team',v_team,'votes','[]'::jsonb)),true);
  v_state := jsonb_set(v_state,'{events}',v_game.public_state->'events' || jsonb_build_array(jsonb_build_object('title','Team proposed','detail',v_team_names||' nominated by '||v_auth.display_name||'.','time',to_char(now(),'HH12:MI AM'))),true);
  update public.games set phase='approval',public_state=v_state where id=v_game.id;
  return v_state;
end; $$;

create or replace function public.avalon_cast_team_vote(p_session_token text, p_choice text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_auth record; v_game public.games%rowtype; v_prop public.proposals%rowtype; v_count int; v_yes int; v_no int; v_accepted boolean; v_votes jsonb; v_state jsonb; v_props jsonb; v_next_rejects int;
begin
  if p_choice not in ('approve','reject') then raise exception 'Vote must be approve or reject.'; end if;
  select * into v_auth from public.avalon_auth_player(p_session_token);
  if not found then raise exception 'Invalid player session.'; end if;
  select * into v_game from public.games where id=v_auth.game_id for update;
  if v_game.phase<>'approval' then raise exception 'It is not the team approval phase.'; end if;
  select * into v_prop from public.proposals where game_id=v_game.id and quest_number=v_game.current_quest order by proposal_number desc limit 1;
  insert into public.team_votes(proposal_id,player_id,choice) values(v_prop.id,v_auth.player_id,p_choice);
  select count(*) into v_count from public.team_votes where proposal_id=v_prop.id;
  if v_count < v_game.player_count then
    return jsonb_set(v_game.public_state,'{teamVoteCount}',to_jsonb(v_count),true);
  end if;
  select count(*) filter(where choice='approve'),count(*) filter(where choice='reject') into v_yes,v_no from public.team_votes where proposal_id=v_prop.id;
  v_accepted := v_yes > v_game.player_count/2.0;
  update public.proposals set approval_count=v_yes,rejection_count=v_no,outcome=case when v_accepted then 'approved' else 'rejected' end,revealed_at=now() where id=v_prop.id;
  select jsonb_agg(jsonb_build_object('playerId',tv.player_id,'choice',tv.choice) order by p.seat_index) into v_votes from public.team_votes tv join public.players p on p.id=tv.player_id where tv.proposal_id=v_prop.id;
  v_props := v_game.public_state->'proposals';
  v_props := jsonb_set(v_props,array[(jsonb_array_length(v_props)-1)::text,'votes'],v_votes,true);
  v_props := jsonb_set(v_props,array[(jsonb_array_length(v_props)-1)::text,'result'],to_jsonb(case when v_accepted then 'approved' else 'rejected' end),true);
  v_state := jsonb_set(v_game.public_state,'{proposals}',v_props,true);
  v_state := jsonb_set(v_state,'{currentVotes}',v_votes,true);
  v_state := jsonb_set(v_state,'{votesRevealed}','true'::jsonb,true);
  if v_accepted then
    v_state := jsonb_set(v_state,'{phase}','"quest"'::jsonb,true);
    v_state := jsonb_set(v_state,'{rejects}','0'::jsonb,true);
    v_state := jsonb_set(v_state,'{questSubmittedCount}','0'::jsonb,true);
    update public.games set phase='quest',rejection_count=0,quest_success_count=0,quest_fail_count=0,public_state=v_state where id=v_game.id;
  else
    v_next_rejects := v_game.rejection_count+1;
    v_state := jsonb_set(v_state,'{rejects}',to_jsonb(v_next_rejects),true);
    if v_next_rejects>=5 then v_state := jsonb_set(v_state,'{phase}','"finished"'::jsonb,true); else v_state := jsonb_set(v_state,'{phase}','"team"'::jsonb,true); end if;
    v_state := jsonb_set(v_state,'{leader}',to_jsonb((v_game.current_leader+1) % v_game.player_count),true);
    update public.games set phase=case when v_next_rejects>=5 then 'finished' else 'team' end,rejection_count=v_next_rejects,current_leader=(current_leader+1)%player_count,public_state=v_state where id=v_game.id;
  end if;
  v_state := jsonb_set(v_state,'{events}',v_state->'events' || jsonb_build_array(jsonb_build_object('title','Team vote revealed','detail',v_yes||' approve, '||v_no||' reject. '||case when v_accepted then 'Team approved.' else 'Team rejected.' end,'time',to_char(now(),'HH12:MI AM'))),true);
  update public.games set public_state=v_state where id=v_game.id;
  return v_state;
end; $$;

create or replace function public.avalon_cast_quest_vote(p_session_token text, p_choice text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_auth record; v_game public.games%rowtype; v_submitted int; v_team uuid[]; v_fail_needed int; v_result text; v_success int; v_fail int; v_history jsonb; v_state jsonb; v_successes int; v_fails int; v_next_quest int; v_team_names text;
begin
  if p_choice not in ('success','fail') then raise exception 'Card must be Success or Fail.'; end if;
  select * into v_auth from public.avalon_auth_player(p_session_token);
  if not found then raise exception 'Invalid player session.'; end if;
  select * into v_game from public.games where id=v_auth.game_id for update;
  if v_game.phase<>'quest' then raise exception 'It is not the quest voting phase.'; end if;
  if not exists(select 1 from jsonb_array_elements_text(v_game.public_state->'team') x where x::uuid=v_auth.player_id) then raise exception 'You are not on the approved quest team.'; end if;
  insert into public.quest_participation(game_id,quest_number,player_id) values(v_game.id,v_game.current_quest,v_auth.player_id);
  if p_choice='success' then update public.games set quest_success_count=quest_success_count+1 where id=v_game.id returning * into v_game;
  else update public.games set quest_fail_count=quest_fail_count+1 where id=v_game.id returning * into v_game; end if;
  select count(*) into v_submitted from public.quest_participation where game_id=v_game.id and quest_number=v_game.current_quest;
  v_state := jsonb_set(v_game.public_state,'{questSubmittedCount}',to_jsonb(v_submitted),true);
  if v_submitted < jsonb_array_length(v_game.public_state->'team') then return v_state; end if;
  v_success := v_game.quest_success_count; v_fail := v_game.quest_fail_count;
  v_fail_needed := case when v_game.player_count>=7 and v_game.current_quest=4 then 2 else 1 end;
  v_result := case when v_fail>=v_fail_needed then 'fail' else 'success' end;
  select array_agg(value::uuid) into v_team from jsonb_array_elements_text(v_game.public_state->'team');
  insert into public.quest_results(game_id,quest_number,team_player_ids,success_count,fail_count,outcome)
  values(v_game.id,v_game.current_quest,v_team,v_success,v_fail,v_result);
  v_history := coalesce(v_game.public_state->'history','[]'::jsonb) || jsonb_build_array(jsonb_build_object('quest',v_game.current_quest,'team',to_jsonb(v_team),'success',v_success,'fail',v_fail,'result',v_result,'proposal',jsonb_array_length(v_game.public_state->'proposals')));
  v_state := jsonb_set(v_state,'{history}',v_history,true);
  v_state := jsonb_set(v_state,'{questSuccess}',to_jsonb(v_success),true);
  v_state := jsonb_set(v_state,'{questFail}',to_jsonb(v_fail),true);
  v_state := jsonb_set(v_state,'{events}',v_state->'events' || jsonb_build_array(jsonb_build_object('title','Quest resolved','detail','Quest '||v_game.current_quest||': '||v_success||' Success, '||v_fail||' Fail. '||upper(v_result)||'.','time',to_char(now(),'HH12:MI AM'))),true);
  select count(*) into v_successes from jsonb_array_elements(v_history) h where h->>'result'='success';
  select count(*) into v_fails from jsonb_array_elements(v_history) h where h->>'result'='fail';
  if v_game.current_quest>=5 or v_successes>=3 or v_fails>=3 then
    v_state := jsonb_set(v_state,'{phase}','"finished"'::jsonb,true);
    update public.games set phase='finished',public_state=v_state where id=v_game.id;
  else
    v_next_quest := v_game.current_quest+1;
    v_state := jsonb_set(v_state,'{phase}','"team"'::jsonb,true);
    v_state := jsonb_set(v_state,'{quest}',to_jsonb(v_next_quest),true);
    v_state := jsonb_set(v_state,'{leader}',to_jsonb((v_game.current_leader+1)%v_game.player_count),true);
    v_state := jsonb_set(v_state,'{team}','[]'::jsonb,true);
    v_state := jsonb_set(v_state,'{questSubmittedCount}','0'::jsonb,true);
    update public.games set phase='team',current_quest=v_next_quest,current_leader=(current_leader+1)%player_count,rejection_count=0,quest_success_count=0,quest_fail_count=0,public_state=v_state where id=v_game.id;
  end if;
  return v_state;
exception when unique_violation then raise exception 'You have already submitted a quest card.';
end; $$;

-- RPCs are the only permitted client interface. Tokens are opaque, random, and stored hashed.
revoke all on function public.avalon_create_room(text) from public, anon, authenticated;
revoke all on function public.avalon_join_room(text,text) from public, anon, authenticated;
revoke all on function public.avalon_get_state(text) from public, anon, authenticated;
revoke all on function public.avalon_start_game(text) from public, anon, authenticated;
revoke all on function public.avalon_propose_team(text,uuid[]) from public, anon, authenticated;
revoke all on function public.avalon_cast_team_vote(text,text) from public, anon, authenticated;
revoke all on function public.avalon_cast_quest_vote(text,text) from public, anon, authenticated;
grant execute on function public.avalon_create_room(text) to anon, authenticated;
grant execute on function public.avalon_join_room(text,text) to anon, authenticated;
grant execute on function public.avalon_get_state(text) to anon, authenticated;
grant execute on function public.avalon_start_game(text) to anon, authenticated;
grant execute on function public.avalon_propose_team(text,uuid[]) to anon, authenticated;
grant execute on function public.avalon_cast_team_vote(text,text) to anon, authenticated;
grant execute on function public.avalon_cast_quest_vote(text,text) to anon, authenticated;
revoke all on function public.avalon_auth_player(text) from public, anon, authenticated;
revoke all on function public.avalon_team_size(int,int) from public, anon, authenticated;

-- Realtime is deliberately not used for ballot writes. Clients poll the safe get_state RPC;
-- this prevents raw quest ballot submissions from leaking through broadcast payloads.
