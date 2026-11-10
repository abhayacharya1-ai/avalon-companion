-- Run once in Supabase SQL Editor after production.sql.
-- Allow the room host to confirm the current leader's spoken nomination.
-- The proposal remains attributed to the actual rotating game leader.
create or replace function public.avalon_propose_team(p_session_token text, p_player_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_auth record; v_game public.games%rowtype; v_state jsonb; v_team jsonb; v_proposal_id uuid := gen_random_uuid(); v_required int; v_num int; v_team_names text; v_leader_id uuid; v_leader_name text;
begin
  select * into v_auth from public.avalon_auth_player(p_session_token);
  if not found then raise exception 'Invalid player session.'; end if;
  select * into v_game from public.games where id=v_auth.game_id for update;
  if v_game.phase<>'team' then raise exception 'It is not the team nomination phase.'; end if;
  if v_auth.seat_index<>v_game.current_leader and v_auth.seat_index<>0 then raise exception 'Only the leader or host moderator can confirm a nomination.'; end if;
  v_required := public.avalon_team_size(v_game.player_count,v_game.current_quest);
  if coalesce(array_length(p_player_ids,1),0)<>v_required or (select count(distinct x) from unnest(p_player_ids) x)<>v_required then raise exception 'Select exactly % unique players.',v_required; end if;
  if exists(select 1 from unnest(p_player_ids) x where not exists(select 1 from public.players p where p.id=x and p.game_id=v_game.id)) then raise exception 'Team contains a player outside this room.'; end if;
  select id,display_name into v_leader_id,v_leader_name from public.players where game_id=v_game.id and seat_index=v_game.current_leader;
  v_num := jsonb_array_length(v_game.public_state->'proposals')+1;
  insert into public.proposals(id,game_id,quest_number,proposal_number,leader_player_id,team_player_ids)
  values(v_proposal_id,v_game.id,v_game.current_quest,v_num,v_leader_id,p_player_ids);
  select string_agg(display_name,', ' order by seat_index) into v_team_names from public.players where id=any(p_player_ids);
  v_team := to_jsonb(p_player_ids);
  v_state := jsonb_set(v_game.public_state,'{phase}','"approval"'::jsonb,true);
  v_state := jsonb_set(v_state,'{team}',v_team,true);
  v_state := jsonb_set(v_state,'{currentVotes}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{votesRevealed}','false'::jsonb,true);
  v_state := jsonb_set(v_state,'{proposals}',v_game.public_state->'proposals' || jsonb_build_array(jsonb_build_object('id',v_proposal_id,'leaderId',v_leader_id,'team',v_team,'votes','[]'::jsonb)),true);
  v_state := jsonb_set(v_state,'{events}',v_game.public_state->'events' || jsonb_build_array(jsonb_build_object('title','Team proposed','detail',v_team_names||' nominated by '||v_leader_name||'.','time',to_char(now(),'HH12:MI AM'))),true);
  update public.games set phase='approval',public_state=v_state where id=v_game.id;
  return v_state;
end; $$;

