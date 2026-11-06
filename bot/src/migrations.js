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
  {
    id: '002_notify_outbox',
    sql: `
      CREATE TABLE notify_outbox (
        id bigserial PRIMARY KEY,
        dedupe_key text NOT NULL UNIQUE,
        tg_id bigint NOT NULL,
        kind text NOT NULL,
        lang text CHECK (lang IN ('en', 'fa')),
        vars jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed', 'expired')),
        attempts int NOT NULL DEFAULT 0,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        next_try_at timestamptz NOT NULL DEFAULT now(),
        done_at timestamptz
      );
      CREATE INDEX notify_outbox_due ON notify_outbox (next_try_at) WHERE status = 'pending';
      CREATE INDEX notify_outbox_done ON notify_outbox (done_at) WHERE status <> 'pending';
    `,
  },
  {
    id: '003_chats_news',
    sql: `ALTER TABLE chats ADD COLUMN news boolean NOT NULL DEFAULT true;`,
  },
];
