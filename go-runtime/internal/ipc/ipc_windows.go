//go:build windows

package ipc

import (
	"github.com/Microsoft/go-winio"
	"net"
)

func platformEndpoint(name string) string {
	return `\\.\pipe\oc-runtime-` + name
}

type winListener struct {
	net.Listener
	endpoint string
}

func (w *winListener) Endpoint() string { return w.endpoint }

func Listen() (Listener, error) {
	ep := DefaultEndpoint()
	l, err := winio.ListenPipe(ep, &winio.PipeConfig{
		MessageMode:        false,
		InputBufferSize:    65536,
		OutputBufferSize:   65536,
	})
	if err != nil {
		return nil, err
	}
	return &winListener{Listener: l, endpoint: ep}, nil
}
