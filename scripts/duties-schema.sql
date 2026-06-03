-- Powers-and-duties schema for Aurora Serverless v2 Postgres.
--
-- Postgres port of the SQLite schema in scripts/build-duties-db.js, with one
-- meaningful divergence: the source CSVs flatten "one duty, N actor aliases"
-- into N near-identical rows (same dutyTempId, same duty_uri, same action,
-- differing only in actor_is_alias and occasionally body_uri). The SQLite
-- path silently dropped the 2nd-and-later rows of each cluster. Here, the
-- ingest pre-aggregates per file and stores the variations in a JSONB
-- `actor_aliases` array — no information lost, no row inflation.
--
-- Applied once via Data API (scripts/apply-duties-schema.js) after the cluster
-- is provisioned. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS duties (
  duty_id          BIGINT PRIMARY KEY,
  duty_uri         TEXT NOT NULL UNIQUE,
  enactment_uri    TEXT NOT NULL,
  enactment_title  TEXT NOT NULL,
  enactment_year   INTEGER,
  enactment_type   TEXT NOT NULL,
  enactment_num    TEXT NOT NULL,
  section_uri      TEXT,
  subsection       TEXT,
  -- Actor model:
  --   actor: the term as written in the legislation, e.g. "NHS body".
  --   actor_definition: the source definition of the term (if defined).
  --   actor_aliases: array of {name, is_body, body_uri} objects resolving
  --     the term to one or more concrete actor instances. For ~97.7% of
  --     duties this has one entry; for ~2.3% it has 2-43 entries because
  --     the term resolves to multiple body types (e.g. "NHS body" → Local
  --     Health Board, NHS trust). The flat per-row actor_is_alias /
  --     actor_is_body / body_uri columns from the SQLite schema are folded
  --     into per-alias JSON entries here.
  actor            TEXT,
  actor_definition TEXT,
  actor_aliases    JSONB NOT NULL DEFAULT '[]'::jsonb,
  modality         TEXT NOT NULL CHECK (modality IN ('duty', 'power')),
  action           TEXT NOT NULL,
  condition        TEXT,
  inference        TEXT NOT NULL CHECK (inference IN ('explicit', 'implicit')),
  priority         TEXT NOT NULL CHECK (priority IN ('primary', 'secondary')),
  version_date     TEXT,
  order_key        TEXT,
  -- FTS target. Covers action + condition + actor (the legislation term).
  -- Alias names are NOT included here — generated columns can't reference
  -- jsonb_array_elements (not IMMUTABLE). Use the GIN index below for
  -- alias-name filters.
  search_tsv       TSVECTOR GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(action, '') || ' ' ||
      coalesce(condition, '') || ' ' ||
      coalesce(actor, '')
    )
  ) STORED
);

-- Btree indexes — direct port of the SQLite indexes.
CREATE INDEX IF NOT EXISTS idx_duties_enactment ON duties (enactment_uri, order_key);
CREATE INDEX IF NOT EXISTS idx_duties_type_year ON duties (enactment_type, enactment_year);
CREATE INDEX IF NOT EXISTS idx_duties_actor     ON duties (actor);
CREATE INDEX IF NOT EXISTS idx_duties_modality  ON duties (modality, priority, inference);

-- GIN on the FTS column.
CREATE INDEX IF NOT EXISTS idx_duties_search_tsv ON duties USING GIN (search_tsv);

-- GIN on the JSON column for @> containment queries — supports filters
-- like `actor_aliases @> '[{"name": "Local Health Board"}]'`. jsonb_path_ops
-- is the right opclass for @> (smaller, faster than the default).
CREATE INDEX IF NOT EXISTS idx_duties_actor_aliases ON duties USING GIN (actor_aliases jsonb_path_ops);

-- Resumable-ingest bookkeeping. With per-file pre-aggregation the script
-- treats files atomically — completion is binary (completed_at is set or
-- not) rather than a row-offset counter.
CREATE TABLE IF NOT EXISTS bootstrap_progress (
  file_name       TEXT PRIMARY KEY,
  duties_loaded   BIGINT NOT NULL DEFAULT 0,
  completed_at    TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
