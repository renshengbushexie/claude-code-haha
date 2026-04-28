// Package state defines the task state machine for the Go runtime.
//
// This is the SOLE source of truth for legal task state transitions.
// The TS layer must never mutate task state directly; all mutations
// flow through RPC into TransitionTask which consults Allowed().
//
// See .opencode/design/state-machine.md for the design rationale,
// transition matrix, and trigger ownership.
package state

// Status is the task status string persisted in the tasks.status column
// (and CHECK-constrained by 0001_init.sql).
type Status string

const (
	Pending          Status = "pending"
	Queued           Status = "queued"
	Running          Status = "running"
	Blocked          Status = "blocked"
	Retrying         Status = "retrying"
	Completed        Status = "completed"
	Failed           Status = "failed"
	Timeout          Status = "timeout"
	Cancelled        Status = "cancelled"
	ManualAttention  Status = "manual_attention"
)

// All returns every legal status value (stable iteration order: definition order).
// Used by tests and validation.
func All() []Status {
	return []Status{
		Pending, Queued, Running, Blocked, Retrying,
		Completed, Failed, Timeout, Cancelled, ManualAttention,
	}
}

// IsTerminal reports whether s is a terminal state. Terminal states are
// completed/failed/timeout/cancelled — once entered, no further transitions.
func IsTerminal(s Status) bool {
	switch s {
	case Completed, Failed, Timeout, Cancelled:
		return true
	}
	return false
}

// IsValid reports whether s is one of the 10 known statuses.
func IsValid(s Status) bool {
	for _, v := range All() {
		if v == s {
			return true
		}
	}
	return false
}

// transitions encodes the legal transition matrix from
// .opencode/design/state-machine.md §"迁移合法性矩阵".
//
// Layout: transitions[from] = set of allowed `to` states.
// Terminal states (completed/failed/timeout/cancelled) deliberately
// have NO entry — IsTerminal() guards them at the top of Allowed().
var transitions = map[Status]map[Status]struct{}{
	Pending: {
		Queued:    {},
		Cancelled: {},
	},
	Queued: {
		Running:   {},
		Timeout:   {},
		Cancelled: {},
	},
	Running: {
		Blocked:         {},
		Retrying:        {},
		Completed:       {},
		Failed:          {},
		Timeout:         {},
		Cancelled:       {},
		ManualAttention: {},
	},
	Blocked: {
		Running:         {},
		Failed:          {},
		Timeout:         {},
		Cancelled:       {},
		ManualAttention: {},
	},
	Retrying: {
		Queued:    {},
		Failed:    {},
		Cancelled: {},
	},
	ManualAttention: {
		Running:   {},
		Failed:    {},
		Cancelled: {},
	},
}

// Allowed reports whether the from→to transition is legal.
//
// Rules enforced:
//   - both states must be IsValid
//   - terminal `from` states reject every transition (immutability invariant)
//   - the transitions matrix is consulted for non-terminal `from`
func Allowed(from, to Status) bool {
	if !IsValid(from) || !IsValid(to) {
		return false
	}
	if IsTerminal(from) {
		return false
	}
	allowed, ok := transitions[from]
	if !ok {
		return false
	}
	_, ok = allowed[to]
	return ok
}
