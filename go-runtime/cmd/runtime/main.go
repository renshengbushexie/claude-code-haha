package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/open-claude-code/go-runtime/internal/ipc"
	applog "github.com/open-claude-code/go-runtime/internal/log"
	"github.com/open-claude-code/go-runtime/internal/rpc"
	"github.com/open-claude-code/go-runtime/internal/store"
)

func main() {
	var (
		dataDir  string
		logLevel string
	)
	flag.StringVar(&dataDir, "data-dir", defaultDataDir(), "directory for runtime.db and artifacts")
	flag.StringVar(&logLevel, "log-level", "info", "debug | info | warn | error")
	flag.Parse()

	log := applog.New(logLevel)

	db, err := store.Open(dataDir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "open store:", err)
		os.Exit(1)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := db.Migrate(ctx); err != nil {
		cancel()
		fmt.Fprintln(os.Stderr, "migrate:", err)
		os.Exit(1)
	}
	cancel()

	listener, err := ipc.Listen()
	if err != nil {
		fmt.Fprintln(os.Stderr, "listen:", err)
		os.Exit(1)
	}

	endpointFile := filepath.Join(dataDir, "runtime.endpoint")
	if err := os.WriteFile(endpointFile, []byte(listener.Endpoint()), 0o600); err != nil {
		fmt.Fprintln(os.Stderr, "write endpoint file:", err)
		os.Exit(1)
	}
	defer os.Remove(endpointFile)

	srv := rpc.NewServer(db, log, listener.Endpoint())
	httpSrv := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Info("runtime_started",
		"version", rpc.Version,
		"endpoint", listener.Endpoint(),
		"db", db.Path(),
		"pid", os.Getpid(),
	)
	fmt.Println("oc-runtime ready endpoint=" + listener.Endpoint())

	errCh := make(chan error, 1)
	go func() { errCh <- httpSrv.Serve(listener) }()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		log.Info("shutting_down", "signal", sig.String())
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			log.Error("serve_error", "err", err)
		}
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}

func defaultDataDir() string {
	if v := os.Getenv("OC_RUNTIME_DATA_DIR"); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".oc-runtime"
	}
	return filepath.Join(home, ".claude-haha", "runtime")
}
