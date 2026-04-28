package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type Task struct {
	ID            string  `json:"id"`
	SessionID     *string `json:"session_id,omitempty"`
	ParentTaskID  *string `json:"parent_task_id,omitempty"`
	Prompt        string  `json:"prompt"`
	Model         *string `json:"model,omitempty"`
	Cwd           string  `json:"cwd"`
	Status        string  `json:"status"`
	Priority      int     `json:"priority"`
	MaxAttempts   int     `json:"max_attempts"`
	AttemptsUsed  int     `json:"attempts_used"`
	DeadlineMs    *int64  `json:"deadline_ms,omitempty"`
	CreatedAt     int64   `json:"created_at"`
	UpdatedAt     int64   `json:"updated_at"`
	StartedAt     *int64  `json:"started_at,omitempty"`
	FinishedAt    *int64  `json:"finished_at,omitempty"`
	LastError     *string `json:"last_error,omitempty"`
}

type CreateTaskInput struct {
	Prompt    string
	Cwd       string
	Model     *string
	SessionID *string
	Priority  int
}

var ErrNotFound = errors.New("not found")

func (db *DB) CreateTask(ctx context.Context, in CreateTaskInput) (*Task, error) {
	id := newID()
	now := time.Now().UnixMilli()
	t := &Task{
		ID:           id,
		SessionID:    in.SessionID,
		Prompt:       in.Prompt,
		Model:        in.Model,
		Cwd:          in.Cwd,
		Status:       "pending",
		Priority:     in.Priority,
		MaxAttempts:  1,
		AttemptsUsed: 0,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	_, err := db.ExecContext(ctx, `INSERT INTO tasks
		(id, session_id, parent_task_id, prompt, model, cwd, status, priority, max_attempts, attempts_used, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		t.ID, t.SessionID, t.ParentTaskID, t.Prompt, t.Model, t.Cwd, t.Status,
		t.Priority, t.MaxAttempts, t.AttemptsUsed, t.CreatedAt, t.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return t, nil
}

func (db *DB) GetTask(ctx context.Context, id string) (*Task, error) {
	row := db.QueryRowContext(ctx, `SELECT
		id, session_id, parent_task_id, prompt, model, cwd, status, priority,
		max_attempts, attempts_used, deadline_ms, created_at, updated_at,
		started_at, finished_at, last_error
		FROM tasks WHERE id = ?`, id)
	t, err := scanTask(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

func (db *DB) ListTasks(ctx context.Context, limit int) ([]*Task, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := db.QueryContext(ctx, `SELECT
		id, session_id, parent_task_id, prompt, model, cwd, status, priority,
		max_attempts, attempts_used, deadline_ms, created_at, updated_at,
		started_at, finished_at, last_error
		FROM tasks ORDER BY updated_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*Task, 0, limit)
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

type scanner interface {
	Scan(dest ...any) error
}

func scanTask(s scanner) (*Task, error) {
	var t Task
	err := s.Scan(
		&t.ID, &t.SessionID, &t.ParentTaskID, &t.Prompt, &t.Model, &t.Cwd, &t.Status, &t.Priority,
		&t.MaxAttempts, &t.AttemptsUsed, &t.DeadlineMs, &t.CreatedAt, &t.UpdatedAt,
		&t.StartedAt, &t.FinishedAt, &t.LastError,
	)
	if err != nil {
		return nil, err
	}
	return &t, nil
}
