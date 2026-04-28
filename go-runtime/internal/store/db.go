package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type DB struct {
	*sql.DB
	path string
}

func Open(dataDir string) (*DB, error) {
	if err := ensureDir(dataDir); err != nil {
		return nil, err
	}
	path := filepath.Join(dataDir, "runtime.db")
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=foreign_keys(on)", path)
	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	return &DB{DB: sqlDB, path: path}, nil
}

func (db *DB) Path() string { return db.path }

func (db *DB) Migrate(ctx context.Context) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL
	)`); err != nil {
		return err
	}
	applied := map[int]bool{}
	rows, err := db.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return err
		}
		applied[v] = true
	}
	rows.Close()

	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	type mig struct {
		version int
		name    string
		body    []byte
	}
	migs := make([]mig, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".sql") {
			continue
		}
		under := strings.IndexByte(name, '_')
		if under < 0 {
			continue
		}
		v, err := strconv.Atoi(name[:under])
		if err != nil {
			continue
		}
		body, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		migs = append(migs, mig{version: v, name: name, body: body})
	}
	sort.Slice(migs, func(i, j int) bool { return migs[i].version < migs[j].version })

	for _, m := range migs {
		if applied[m.version] {
			continue
		}
		if _, err := db.ExecContext(ctx, string(m.body)); err != nil {
			return fmt.Errorf("apply %s: %w", m.name, err)
		}
		if _, err := db.ExecContext(ctx,
			`INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)`,
			m.version, m.name, time.Now().UnixMilli(),
		); err != nil {
			return err
		}
	}
	return nil
}
