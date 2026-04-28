package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/open-claude-code/go-runtime/internal/state"
)

func newTestDB(t *testing.T) *DB {
	t.Helper()
	dir := t.TempDir()
	db, err := Open(filepath.Clean(dir))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	if err := db.Migrate(context.Background()); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	return db
}

func mustCreate(t *testing.T, db *DB) *Task {
	t.Helper()
	tsk, err := db.CreateTask(context.Background(), CreateTaskInput{
		Prompt: "p", Cwd: "/tmp",
	})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	return tsk
}

func TestTransitionTask_HappyPath(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	tsk := mustCreate(t, db)

	if tsk.Status != "pending" {
		t.Fatalf("new task status = %q, want pending", tsk.Status)
	}

	t1, err := db.TransitionTask(ctx, tsk.ID, state.Pending, state.Queued, "")
	if err != nil {
		t.Fatalf("pending->queued: %v", err)
	}
	if t1.Status != "queued" {
		t.Errorf("after pending->queued, status = %q", t1.Status)
	}
	if t1.UpdatedAt < tsk.UpdatedAt {
		t.Errorf("updated_at not bumped")
	}
	if t1.StartedAt != nil {
		t.Errorf("started_at should still be nil after queued")
	}

	t2, err := db.TransitionTask(ctx, tsk.ID, state.Queued, state.Running, "")
	if err != nil {
		t.Fatalf("queued->running: %v", err)
	}
	if t2.StartedAt == nil {
		t.Errorf("started_at should be set on entering running")
	}
	startedAt := *t2.StartedAt

	t3, err := db.TransitionTask(ctx, tsk.ID, state.Running, state.Completed, "")
	if err != nil {
		t.Fatalf("running->completed: %v", err)
	}
	if t3.FinishedAt == nil {
		t.Errorf("finished_at should be set on terminal state")
	}
	if t3.StartedAt == nil || *t3.StartedAt != startedAt {
		t.Errorf("started_at should be preserved by COALESCE; got %v want %v", t3.StartedAt, startedAt)
	}
}

func TestTransitionTask_RejectsIllegalTransition(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	tsk := mustCreate(t, db)

	_, err := db.TransitionTask(ctx, tsk.ID, state.Pending, state.Completed, "")
	if !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("pending->completed should be illegal, got %v", err)
	}

	got, _ := db.GetTask(ctx, tsk.ID)
	if got.Status != "pending" {
		t.Errorf("status changed despite illegal transition: %q", got.Status)
	}
}

func TestTransitionTask_TerminalIsImmutable(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	tsk := mustCreate(t, db)

	_, _ = db.TransitionTask(ctx, tsk.ID, state.Pending, state.Queued, "")
	_, _ = db.TransitionTask(ctx, tsk.ID, state.Queued, state.Running, "")
	_, _ = db.TransitionTask(ctx, tsk.ID, state.Running, state.Completed, "")

	_, err := db.TransitionTask(ctx, tsk.ID, state.Completed, state.Running, "")
	if !errors.Is(err, ErrIllegalTransition) {
		t.Errorf("completed->running should be illegal, got %v", err)
	}
}

func TestTransitionTask_StateMismatch(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	tsk := mustCreate(t, db)

	_, err := db.TransitionTask(ctx, tsk.ID, state.Running, state.Completed, "")
	if !errors.Is(err, ErrStateMismatch) {
		t.Fatalf("expectedFrom=running but row=pending should mismatch, got %v", err)
	}
}

func TestTransitionTask_NotFound(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	_, err := db.TransitionTask(ctx, "nonexistent-id", state.Pending, state.Queued, "")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestTransitionTask_FailedRecordsLastError(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	tsk := mustCreate(t, db)

	_, _ = db.TransitionTask(ctx, tsk.ID, state.Pending, state.Queued, "")
	_, _ = db.TransitionTask(ctx, tsk.ID, state.Queued, state.Running, "")
	out, err := db.TransitionTask(ctx, tsk.ID, state.Running, state.Failed, "child exit 137")
	if err != nil {
		t.Fatalf("running->failed: %v", err)
	}
	if out.LastError == nil || *out.LastError != "child exit 137" {
		t.Errorf("last_error not persisted; got %v", out.LastError)
	}
}

func TestListTransitions_RecordsEveryStep(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	tsk := mustCreate(t, db)

	steps := []struct{ from, to state.Status }{
		{state.Pending, state.Queued},
		{state.Queued, state.Running},
		{state.Running, state.Blocked},
		{state.Blocked, state.Running},
		{state.Running, state.Completed},
	}
	for _, s := range steps {
		if _, err := db.TransitionTask(ctx, tsk.ID, s.from, s.to, ""); err != nil {
			t.Fatalf("%s->%s: %v", s.from, s.to, err)
		}
	}

	tr, err := db.ListTransitions(ctx, tsk.ID)
	if err != nil {
		t.Fatalf("ListTransitions: %v", err)
	}
	if len(tr) != len(steps) {
		t.Fatalf("got %d transitions, want %d", len(tr), len(steps))
	}
	for i, s := range steps {
		if tr[i].From != string(s.from) || tr[i].To != string(s.to) {
			t.Errorf("step %d: got %s->%s, want %s->%s", i, tr[i].From, tr[i].To, s.from, s.to)
		}
		if i > 0 && tr[i].Seq <= tr[i-1].Seq {
			t.Errorf("seq not monotonic at step %d: %d after %d", i, tr[i].Seq, tr[i-1].Seq)
		}
	}
}

func TestListTransitions_EmptyForNewTask(t *testing.T) {
	db := newTestDB(t)
	tsk := mustCreate(t, db)
	tr, err := db.ListTransitions(context.Background(), tsk.ID)
	if err != nil {
		t.Fatalf("ListTransitions: %v", err)
	}
	if len(tr) != 0 {
		t.Errorf("new task should have 0 transitions, got %d", len(tr))
	}
}
