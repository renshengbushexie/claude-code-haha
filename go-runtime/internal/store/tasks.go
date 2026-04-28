package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/open-claude-code/go-runtime/internal/state"
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

// ErrIllegalTransition is returned by TransitionTask when the requested
// from→to pair is rejected by state.Allowed (terminal-from or matrix miss).
var ErrIllegalTransition = errors.New("illegal state transition")

// ErrStateMismatch is returned by TransitionTask when the caller's
// expectedFrom does not match the row's current status (CAS-style guard
// against concurrent transitions).
var ErrStateMismatch = errors.New("state mismatch")

// TaskTransition is one row from the task_events log filtered to type='transition'.
type TaskTransition struct {
	Seq    int64  `json:"seq"`
	TS     int64  `json:"ts"`
	From   string `json:"from"`
	To     string `json:"to"`
	Reason string `json:"reason,omitempty"`
}

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

// TransitionTask atomically moves a task from expectedFrom to to, recording
// a transition event in task_events. The operation is rejected if:
//   - the task does not exist (ErrNotFound)
//   - the current row status differs from expectedFrom (ErrStateMismatch)
//   - state.Allowed(expectedFrom, to) is false (ErrIllegalTransition)
//
// On success, returns the updated *Task. updated_at, started_at, finished_at,
// and last_error are maintained automatically based on the target state.
func (db *DB) TransitionTask(ctx context.Context, id string, expectedFrom, to state.Status, reason string) (*Task, error) {
	if !state.IsValid(expectedFrom) || !state.IsValid(to) {
		return nil, ErrIllegalTransition
	}
	if !state.Allowed(expectedFrom, to) {
		return nil, ErrIllegalTransition
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var current string
	if err := tx.QueryRowContext(ctx, `SELECT status FROM tasks WHERE id = ?`, id).Scan(&current); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if current != string(expectedFrom) {
		return nil, fmt.Errorf("%w: have %q, want %q", ErrStateMismatch, current, expectedFrom)
	}

	now := time.Now().UnixMilli()
	setStarted := to == state.Running
	setFinished := state.IsTerminal(to)

	var sb = `UPDATE tasks SET status = ?, updated_at = ?`
	args := []any{string(to), now}
	if setStarted {
		sb += `, started_at = COALESCE(started_at, ?)`
		args = append(args, now)
	}
	if setFinished {
		sb += `, finished_at = ?`
		args = append(args, now)
	}
	if to == state.Failed && reason != "" {
		sb += `, last_error = ?`
		args = append(args, reason)
	}
	sb += ` WHERE id = ? AND status = ?`
	args = append(args, id, string(expectedFrom))

	res, err := tx.ExecContext(ctx, sb, args...)
	if err != nil {
		return nil, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n != 1 {
		return nil, ErrStateMismatch
	}

	payload, _ := json.Marshal(map[string]any{
		"from":   string(expectedFrom),
		"to":     string(to),
		"reason": reason,
	})
	if _, err := tx.ExecContext(ctx, `INSERT INTO task_events
		(ts, type, scope, task_id, payload) VALUES (?, ?, ?, ?, ?)`,
		now, "transition", "task", id, string(payload)); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return db.GetTask(ctx, id)
}

// ListTransitions returns every transition recorded for a task, oldest first.
// Returns an empty slice (not an error) when no events exist.
func (db *DB) ListTransitions(ctx context.Context, taskID string) ([]TaskTransition, error) {
	rows, err := db.QueryContext(ctx, `SELECT seq, ts, payload
		FROM task_events
		WHERE task_id = ? AND type = 'transition'
		ORDER BY seq ASC`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]TaskTransition, 0, 8)
	for rows.Next() {
		var (
			seq, ts int64
			raw     string
		)
		if err := rows.Scan(&seq, &ts, &raw); err != nil {
			return nil, err
		}
		var p struct {
			From   string `json:"from"`
			To     string `json:"to"`
			Reason string `json:"reason"`
		}
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			return nil, err
		}
		out = append(out, TaskTransition{
			Seq: seq, TS: ts, From: p.From, To: p.To, Reason: p.Reason,
		})
	}
	return out, rows.Err()
}
