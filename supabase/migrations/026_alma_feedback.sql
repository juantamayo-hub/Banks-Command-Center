-- 026: Alma — valoración de cada respuesta (👍/👎 + comentario) y lecciones aprendidas
--
-- alma_messages.feedback_*: lo que la persona opina de cada respuesta de Alma. Con 👎 el comentario es obligatorio.
-- alma_lessons: reglas curadas (por Juanjo) a partir del feedback. Las activas se añaden a las instrucciones
-- de Alma en cada conversación. Los comentarios de los usuarios NUNCA se inyectan tal cual (evita prompt injection).
-- Aditivo: no toca datos existentes.

alter table alma_messages add column if not exists feedback_rating  text check (feedback_rating in ('up', 'down'));
alter table alma_messages add column if not exists feedback_comment text;
alter table alma_messages add column if not exists feedback_at      timestamptz;
alter table alma_messages add column if not exists feedback_by      text;

create index if not exists idx_alma_messages_feedback on alma_messages (feedback_rating, feedback_at desc)
  where feedback_rating is not null;

create table if not exists alma_lessons (
  id                 uuid primary key default gen_random_uuid(),
  texto              text not null,             -- regla en imperativo, p. ej. "Para Kutxabank mira primero kutxabank_submissions"
  origen_message_id  uuid references alma_messages(id) on delete set null,
  activo             boolean not null default true,
  created_by         text,
  created_at         timestamptz not null default now()
);

alter table alma_lessons enable row level security;

drop policy if exists "alma_lessons_all_service_role" on alma_lessons;
create policy "alma_lessons_all_service_role" on alma_lessons
  for all to service_role using (true) with check (true);
