// Append only. One baseline plus later entries.
export const MIGRATIONS = [
  {
    id: '001_init',
    sql: `
      CREATE TABLE chats (
        tg_id bigint PRIMARY KEY,
        lang text NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'fa')),
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE processed_updates (
        update_id bigint PRIMARY KEY,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX processed_updates_at ON processed_updates (at);
    `,
  },
];
