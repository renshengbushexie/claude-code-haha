//go:build !windows

package ipc

import (
	"net"
	"os"
	"path/filepath"
)

func platformEndpoint(name string) string {
	dir := os.Getenv("XDG_RUNTIME_DIR")
	if dir == "" {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "oc-runtime-"+name+".sock")
}

type unixListener struct {
	net.Listener
	endpoint string
}

func (u *unixListener) Endpoint() string { return u.endpoint }

func Listen() (Listener, error) {
	ep := DefaultEndpoint()
	_ = os.Remove(ep)
	if err := os.MkdirAll(filepath.Dir(ep), 0o700); err != nil {
		return nil, err
	}
	l, err := net.Listen("unix", ep)
	if err != nil {
		return nil, err
	}
	_ = os.Chmod(ep, 0o600)
	return &unixListener{Listener: l, endpoint: ep}, nil
}
