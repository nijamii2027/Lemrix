CREATE TABLE enquiries (
  id TEXT PRIMARY KEY NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  intent TEXT NOT NULL CHECK (intent IN ('sell', 'trade', 'unsure')),
  email TEXT NOT NULL,
  details TEXT NOT NULL
);
