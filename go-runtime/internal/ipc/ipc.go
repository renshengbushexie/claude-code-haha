// Package ipc exposes a cross-platform local listener.
// Windows uses named pipes; POSIX uses unix domain sockets.
package ipc

import (
	"net"
	"os"
	"strconv"
)

// DefaultEndpoint returns a per-process endpoint name.
// PID is used (not username) so client/server agree by reading
// the published <dataDir>/runtime.endpoint file rather than recomputing.
func DefaultEndpoint() string {
	return platformEndpoint("p" + strconv.Itoa(os.Getpid()))
}

type Listener interface {
	net.Listener
	Endpoint() string
}
