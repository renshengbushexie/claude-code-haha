package rpc

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"runtime"

	"github.com/open-claude-code/go-runtime/internal/state"
	"github.com/open-claude-code/go-runtime/internal/store"
)

const Version = "0.1.0"

type Server struct {
	db     *store.DB
	log    *slog.Logger
	mux    *http.ServeMux
	pid    int
	socket string
}

func NewServer(db *store.DB, log *slog.Logger, socket string) *Server {
	s := &Server{
		db:     db,
		log:    log,
		mux:    http.NewServeMux(),
		pid:    os.Getpid(),
		socket: socket,
	}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler { return s.mux }

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("POST /v1/tasks", s.handleCreateTask)
	s.mux.HandleFunc("GET /v1/tasks", s.handleListTasks)
	s.mux.HandleFunc("GET /v1/tasks/{id}", s.handleGetTask)
	s.mux.HandleFunc("POST /v1/tasks/{id}/transition", s.handleTransition)
	s.mux.HandleFunc("POST /v1/tasks/{id}/cancel", s.handleCancel)
	s.mux.HandleFunc("GET /v1/tasks/{id}/transitions", s.handleListTransitions)
}

type healthResp struct {
	OK       bool   `json:"ok"`
	Version  string `json:"version"`
	PID      int    `json:"pid"`
	GoOS     string `json:"goos"`
	GoArch   string `json:"goarch"`
	Endpoint string `json:"endpoint"`
	DBPath   string `json:"db_path"`
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResp{
		OK:       true,
		Version:  Version,
		PID:      s.pid,
		GoOS:     runtime.GOOS,
		GoArch:   runtime.GOARCH,
		Endpoint: s.socket,
		DBPath:   s.db.Path(),
	})
}

type createTaskReq struct {
	Prompt    string  `json:"prompt"`
	Cwd       string  `json:"cwd"`
	Model     *string `json:"model,omitempty"`
	SessionID *string `json:"session_id,omitempty"`
	Priority  int     `json:"priority,omitempty"`
}

func (s *Server) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	var req createTaskReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if req.Prompt == "" {
		writeError(w, http.StatusBadRequest, "missing_prompt", "prompt is required")
		return
	}
	if req.Cwd == "" {
		writeError(w, http.StatusBadRequest, "missing_cwd", "cwd is required")
		return
	}
	t, err := s.db.CreateTask(r.Context(), store.CreateTaskInput{
		Prompt:    req.Prompt,
		Cwd:       req.Cwd,
		Model:     req.Model,
		SessionID: req.SessionID,
		Priority:  req.Priority,
	})
	if err != nil {
		s.log.Error("create_task_failed", "err", err)
		writeError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	tasks, err := s.db.ListTasks(r.Context(), 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

func (s *Server) handleGetTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t, err := s.db.GetTask(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "task not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, t)
}

type transitionReq struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Reason string `json:"reason,omitempty"`
}

func (s *Server) handleTransition(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req transitionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if req.From == "" || req.To == "" {
		writeError(w, http.StatusBadRequest, "missing_states", "from and to are required")
		return
	}
	t, err := s.db.TransitionTask(r.Context(), id, state.Status(req.From), state.Status(req.To), req.Reason)
	if mapped, code, msg := mapTransitionError(err); mapped {
		writeError(w, code, msg, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, t)
}

type cancelReq struct {
	Reason string `json:"reason,omitempty"`
}

// handleCancel moves a task to cancelled. Idempotent: re-cancelling a
// cancelled task returns 200 with the current row. Returns 409 when the
// current state has no allowed edge to cancelled (terminal non-cancelled).
func (s *Server) handleCancel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req cancelReq
	_ = json.NewDecoder(r.Body).Decode(&req)

	current, err := s.db.GetTask(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "task not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if current.Status == string(state.Cancelled) {
		writeJSON(w, http.StatusOK, current)
		return
	}
	from := state.Status(current.Status)
	if !state.Allowed(from, state.Cancelled) {
		writeError(w, http.StatusConflict, "illegal_transition",
			"cannot cancel from "+current.Status)
		return
	}
	t, err := s.db.TransitionTask(r.Context(), id, from, state.Cancelled, req.Reason)
	if mapped, code, msg := mapTransitionError(err); mapped {
		writeError(w, code, msg, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) handleListTransitions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.db.GetTask(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "task not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	tr, err := s.db.ListTransitions(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transitions": tr})
}

// mapTransitionError converts store sentinel errors to HTTP responses.
// Returns (true, status, code) when err is recognized; (false, 0, "") on nil
// or unrecognized errors so the caller can fall through to a generic 500.
func mapTransitionError(err error) (bool, int, string) {
	switch {
	case err == nil:
		return false, 0, ""
	case errors.Is(err, store.ErrNotFound):
		return true, http.StatusNotFound, "not_found"
	case errors.Is(err, store.ErrIllegalTransition):
		return true, http.StatusConflict, "illegal_transition"
	case errors.Is(err, store.ErrStateMismatch):
		return true, http.StatusConflict, "state_mismatch"
	default:
		return true, http.StatusInternalServerError, "db_error"
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": msg},
	})
}
