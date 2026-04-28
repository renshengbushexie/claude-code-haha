package state

import "testing"

func TestIsTerminal(t *testing.T) {
	cases := map[Status]bool{
		Pending: false, Queued: false, Running: false,
		Blocked: false, Retrying: false, ManualAttention: false,
		Completed: true, Failed: true, Timeout: true, Cancelled: true,
	}
	for s, want := range cases {
		if got := IsTerminal(s); got != want {
			t.Errorf("IsTerminal(%q) = %v, want %v", s, got, want)
		}
	}
}

func TestIsValid(t *testing.T) {
	for _, s := range All() {
		if !IsValid(s) {
			t.Errorf("All()-returned status %q is not IsValid", s)
		}
	}
	for _, bad := range []Status{"", "unknown", "PENDING", "queued ", "superseded"} {
		if IsValid(bad) {
			t.Errorf("IsValid(%q) should be false", bad)
		}
	}
}

func TestAll_HasExactlyTenStates(t *testing.T) {
	if got := len(All()); got != 10 {
		t.Fatalf("All() returned %d states; design doc requires exactly 10", got)
	}
}

func TestAllowed_TerminalStatesAreImmutable(t *testing.T) {
	for _, from := range []Status{Completed, Failed, Timeout, Cancelled} {
		for _, to := range All() {
			if Allowed(from, to) {
				t.Errorf("terminal %q must not transition to %q", from, to)
			}
		}
	}
}

func TestAllowed_RejectsInvalidStates(t *testing.T) {
	if Allowed("bogus", Running) {
		t.Error("Allowed should reject unknown from state")
	}
	if Allowed(Pending, "bogus") {
		t.Error("Allowed should reject unknown to state")
	}
	if Allowed(Pending, Pending) {
		t.Error("self-transition pending->pending should be rejected (no-op not modeled)")
	}
}

func TestAllowed_LegalTransitions(t *testing.T) {
	legal := []struct{ from, to Status }{
		{Pending, Queued},
		{Pending, Cancelled},
		{Queued, Running},
		{Queued, Timeout},
		{Queued, Cancelled},
		{Running, Blocked},
		{Running, Retrying},
		{Running, Completed},
		{Running, Failed},
		{Running, Timeout},
		{Running, Cancelled},
		{Running, ManualAttention},
		{Blocked, Running},
		{Blocked, Failed},
		{Blocked, Timeout},
		{Blocked, Cancelled},
		{Blocked, ManualAttention},
		{Retrying, Queued},
		{Retrying, Failed},
		{Retrying, Cancelled},
		{ManualAttention, Running},
		{ManualAttention, Failed},
		{ManualAttention, Cancelled},
	}
	for _, tc := range legal {
		if !Allowed(tc.from, tc.to) {
			t.Errorf("expected Allowed(%q, %q) = true", tc.from, tc.to)
		}
	}
}

func TestAllowed_IllegalTransitions(t *testing.T) {
	illegal := []struct{ from, to Status }{
		{Pending, Running},
		{Pending, Completed},
		{Queued, Blocked},
		{Queued, Completed},
		{Running, Pending},
		{Running, Queued},
		{Blocked, Queued},
		{Blocked, Completed},
		{Retrying, Running},
		{Retrying, Blocked},
		{Retrying, Completed},
		{ManualAttention, Queued},
		{ManualAttention, Blocked},
		{ManualAttention, Completed},
	}
	for _, tc := range illegal {
		if Allowed(tc.from, tc.to) {
			t.Errorf("expected Allowed(%q, %q) = false", tc.from, tc.to)
		}
	}
}

// TestAllowed_ManualAttentionInvariant guards the design rule:
// runtime never auto-resumes manual_attention; transition out must be
// explicit (running via user action, or terminal). The matrix already
// enforces this — this test pins it so future edits cannot regress.
func TestAllowed_ManualAttentionInvariant(t *testing.T) {
	for _, to := range All() {
		want := to == Running || to == Failed || to == Cancelled
		if got := Allowed(ManualAttention, to); got != want {
			t.Errorf("manual_attention -> %q: got %v, want %v", to, got, want)
		}
	}
}

// TestAllowed_ExhaustiveMatrix mechanically verifies every from×to pair
// matches the design doc matrix. Catches drift between code and doc.
func TestAllowed_ExhaustiveMatrix(t *testing.T) {
	expected := map[Status]map[Status]bool{}
	for _, s := range All() {
		expected[s] = map[Status]bool{}
	}
	for _, tc := range []struct{ from, to Status }{
		{Pending, Queued}, {Pending, Cancelled},
		{Queued, Running}, {Queued, Timeout}, {Queued, Cancelled},
		{Running, Blocked}, {Running, Retrying}, {Running, Completed},
		{Running, Failed}, {Running, Timeout}, {Running, Cancelled}, {Running, ManualAttention},
		{Blocked, Running}, {Blocked, Failed}, {Blocked, Timeout},
		{Blocked, Cancelled}, {Blocked, ManualAttention},
		{Retrying, Queued}, {Retrying, Failed}, {Retrying, Cancelled},
		{ManualAttention, Running}, {ManualAttention, Failed}, {ManualAttention, Cancelled},
	} {
		expected[tc.from][tc.to] = true
	}
	for _, from := range All() {
		for _, to := range All() {
			got := Allowed(from, to)
			want := expected[from][to]
			if got != want {
				t.Errorf("Allowed(%q, %q) = %v, want %v", from, to, got, want)
			}
		}
	}
}
