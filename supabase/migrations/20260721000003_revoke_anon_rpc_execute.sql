-- Harden SECURITY DEFINER RPCs: authenticated only; triggers not callable via API

revoke all on function public.claim_display_name(text) from public, anon;
revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.invite_to_hub(uuid) from public, anon;
revoke all on function public.respond_hub_invite(uuid, boolean) from public, anon;
revoke all on function public.heartbeat_presence(uuid) from public, anon;
revoke all on function public.set_presence_offline() from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.random_hunter_name() from public, anon, authenticated;

grant execute on function public.claim_display_name(text) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.invite_to_hub(uuid) to authenticated;
grant execute on function public.respond_hub_invite(uuid, boolean) to authenticated;
grant execute on function public.heartbeat_presence(uuid) to authenticated;
grant execute on function public.set_presence_offline() to authenticated;

-- Fix mutable search_path warnings
create or replace function public.random_hunter_name()
returns text
language plpgsql
set search_path = public
as $$
declare
  candidate text;
  attempts int := 0;
begin
  loop
    attempts := attempts + 1;
    candidate := 'Hunter_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    exit when not exists (
      select 1 from public.profiles p where lower(p.display_name) = lower(candidate)
    );
    if attempts > 20 then
      candidate := 'Hunter_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
      exit;
    end if;
  end loop;
  return candidate;
end;
$$;

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
