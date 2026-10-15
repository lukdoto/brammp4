export const MIGRATIONS: string[] = [
  `
  CREATE TABLE libraries (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, root_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline', last_seen_at TEXT, last_scan_at TEXT
  );
  CREATE TABLE titles (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('movie','series')),
    local_key TEXT NOT NULL UNIQUE, tmdb_id INTEGER, name TEXT NOT NULL, year INTEGER,
    overview TEXT, poster_cache TEXT, backdrop_cache TEXT, matched_at TEXT
  );
  CREATE TABLE items (
    key TEXT PRIMARY KEY, title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    season INTEGER, episode INTEGER, name TEXT, overview TEXT, runtime_s INTEGER
  );
  CREATE TABLE files (
    id INTEGER PRIMARY KEY, item_key TEXT NOT NULL REFERENCES items(key) ON DELETE CASCADE,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL,
    duration_s REAL, width INTEGER, height INTEGER, video_codec TEXT, probed_at TEXT,
    missing INTEGER NOT NULL DEFAULT 0,
    UNIQUE (library_id, rel_path, item_key)
  );
  CREATE TABLE tracks (
    id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('embedded','external')),
    type TEXT NOT NULL CHECK (type IN ('audio','sub')),
    stream_index INTEGER, type_index INTEGER, codec TEXT, lang TEXT, title TEXT,
    is_default INTEGER NOT NULL DEFAULT 0, is_forced INTEGER NOT NULL DEFAULT 0,
    is_sdh INTEGER NOT NULL DEFAULT 0, external_path TEXT
  );
  CREATE TABLE progress (
    item_key TEXT PRIMARY KEY, position_s REAL NOT NULL, duration_s REAL,
    watched INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, device_id TEXT
  );
  CREATE TABLE prefs (
    title_id INTEGER PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE, audio_lang TEXT, sub_lang TEXT
  );
  CREATE TABLE unmatched (
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (library_id, rel_path)
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE INDEX idx_files_item ON files(item_key);
  CREATE INDEX idx_files_library ON files(library_id);
  CREATE INDEX idx_items_title ON items(title_id);
  CREATE INDEX idx_tracks_file ON tracks(file_id);
  `
]
