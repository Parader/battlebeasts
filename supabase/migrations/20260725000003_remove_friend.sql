-- Remove friendship both directions (security definer; either party can call).
create or replace function public.remove_friend(friend_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if friend_user_id is null or friend_user_id = uid then
    raise exception 'Invalid friend';
  end if;

  delete from public.friendships
  where (user_id = uid and friend_id = friend_user_id)
     or (user_id = friend_user_id and friend_id = uid);
end;
$$;

revoke all on function public.remove_friend(uuid) from public, anon;
grant execute on function public.remove_friend(uuid) to authenticated;
