package rpc

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/open-claude-code/go-runtime/internal/store"
)

func newTestServer(t *testing.T) (*httptest.Server, *store.DB) {
	t.Helper()
	db, err := store.Open(filepath.Clean(t.TempDir()))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	if err := db.Migrate(context.Background()); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	srv := NewServer(db, slog.New(slog.NewTextHandler(io.Discard, nil)), "test://socket")
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(func() { ts.Close(); db.Close() })
	return ts, db
}

func doJSON(t *testing.T, ts *httptest.Server, method, path string, body any) (*http.Response, []byte) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, ts.URL+path, rdr)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp, out
}

func createPendingTask(t *testing.T, ts *httptest.Server) string {
	t.Helper()
	resp, body := doJSON(t, ts, "POST", "/v1/tasks", map[string]any{
		"prompt": "hello", "cwd": "/tmp",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create task: status=%d body=%s", resp.StatusCode, body)
	}
	var tk struct{ ID string }
	if err := json.Unmarshal(body, &tk); err != nil {
		t.Fatalf("unmarshal create: %v", err)
	}
	return tk.ID
}

func TestRPC_TransitionHappyPath(t *testing.T) {
	ts, _ := newTestServer(t)
	id := createPendingTask(t, ts)

	resp, body := doJSON(t, ts, "POST", "/v1/tasks/"+id+"/transition", map[string]any{
		"from": "pending", "to": "queued",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("transition: status=%d body=%s", resp.StatusCode, body)
	}
	var tk struct{ Status string }
	_ = json.Unmarshal(body, &tk)
	if tk.Status != "queued" {
		t.Errorf("status = %q, want queued", tk.Status)
	}
}

func TestRPC_TransitionIllegalReturns409(t *testing.T) {
	ts, _ := newTestServer(t)
	id := createPendingTask(t, ts)

	resp, body := doJSON(t, ts, "POST", "/v1/tasks/"+id+"/transition", map[string]any{
		"from": "pending", "to": "completed",
	})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("illegal transition: status=%d body=%s", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "illegal_transition") {
		t.Errorf("body missing error code: %s", body)
	}
}

func TestRPC_TransitionStateMismatchReturns409(t *testing.T) {
	ts, _ := newTestServer(t)
	id := createPendingTask(t, ts)

	resp, body := doJSON(t, ts, "POST", "/v1/tasks/"+id+"/transition", map[string]any{
		"from": "running", "to": "completed",
	})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("state mismatch: status=%d body=%s", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "state_mismatch") {
		t.Errorf("body missing error code: %s", body)
	}
}

func TestRPC_TransitionNotFoundReturns404(t *testing.T) {
	ts, _ := newTestServer(t)
	resp, _ := doJSON(t, ts, "POST", "/v1/tasks/nope/transition", map[string]any{
		"from": "pending", "to": "queued",
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("not found: status=%d", resp.StatusCode)
	}
}

func TestRPC_CancelFromPending(t *testing.T) {
	ts, _ := newTestServer(t)
	id := createPendingTask(t, ts)

	resp, body := doJSON(t, ts, "POST", "/v1/tasks/"+id+"/cancel", map[string]any{
		"reason": "user requested",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("cancel: status=%d body=%s", resp.StatusCode, body)
	}
	var tk struct{ Status string }
	_ = json.Unmarshal(body, &tk)
	if tk.Status != "cancelled" {
		t.Errorf("status = %q, want cancelled", tk.Status)
	}
}

func TestRPC_CancelIsIdempotent(t *testing.T) {
	ts, _ := newTestServer(t)
	id := createPendingTask(t, ts)

	doJSON(t, ts, "POST", "/v1/tasks/"+id+"/cancel", nil)
	resp, body := doJSON(t, ts, "POST", "/v1/tasks/"+id+"/cancel", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("second cancel: status=%d body=%s", resp.StatusCode, body)
	}
	var tk struct{ Status string }
	_ = json.Unmarshal(body, &tk)
	if tk.Status != "cancelled" {
		t.Errorf("status = %q, want cancelled", tk.Status)
	}
}

func TestRPC_CancelCompletedReturns409(t *testing.T) {
	ts, db := newTestServer(t)
	id := createPendingTask(t, ts)

	ctx := context.Background()
	if _, err := db.TransitionTask(ctx, id, "pending", "queued", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.TransitionTask(ctx, id, "queued", "running", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.TransitionTask(ctx, id, "running", "completed", ""); err != nil {
		t.Fatal(err)
	}

	resp, body := doJSON(t, ts, "POST", "/v1/tasks/"+id+"/cancel", nil)
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("cancel completed: status=%d body=%s", resp.StatusCode, body)
	}
}

func TestRPC_ListTransitions(t *testing.T) {
	ts, _ := newTestServer(t)
	id := createPendingTask(t, ts)

	doJSON(t, ts, "POST", "/v1/tasks/"+id+"/transition", map[string]any{"from": "pending", "to": "queued"})
	doJSON(t, ts, "POST", "/v1/tasks/"+id+"/transition", map[string]any{"from": "queued", "to": "running"})
	doJSON(t, ts, "POST", "/v1/tasks/"+id+"/cancel", map[string]any{"reason": "user"})

	resp, body := doJSON(t, ts, "GET", "/v1/tasks/"+id+"/transitions", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list: status=%d body=%s", resp.StatusCode, body)
	}
	var out struct {
		Transitions []struct {
			From, To, Reason string
		}
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, body)
	}
	if len(out.Transitions) != 3 {
		t.Fatalf("got %d transitions, want 3: %s", len(out.Transitions), body)
	}
	want := [][2]string{{"pending", "queued"}, {"queued", "running"}, {"running", "cancelled"}}
	for i, w := range want {
		if out.Transitions[i].From != w[0] || out.Transitions[i].To != w[1] {
			t.Errorf("step %d: got %s->%s want %s->%s",
				i, out.Transitions[i].From, out.Transitions[i].To, w[0], w[1])
		}
	}
	if out.Transitions[2].Reason != "user" {
		t.Errorf("reason not propagated: %q", out.Transitions[2].Reason)
	}
}

func TestRPC_ListTransitionsNotFound(t *testing.T) {
	ts, _ := newTestServer(t)
	resp, _ := doJSON(t, ts, "GET", "/v1/tasks/nope/transitions", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status=%d, want 404", resp.StatusCode)
	}
}
