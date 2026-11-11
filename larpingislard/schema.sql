create table messages (
  id bigserial primary key,
  content text not null check (char_length(content) <= 2000),
  user_id uuid not null default auth.uid(),
  user_email text not null,
  created_at timestamptz not null default now()
);

alter table messages enable row level security;

create policy "members read" on messages
  for select to authenticated using (true);

create policy "members send" on messages
  for insert to authenticated with check (user_id = auth.uid());

alter publication supabase_realtime add table messages;

-- lets people delete their own messages
create policy "delete own" on messages
  for delete to authenticated using (user_id = auth.uid());
