package store

import (
	"crypto/rand"
	"encoding/base32"
	"strings"
	"time"
)

func newID() string {
	var buf [10]byte
	_, _ = rand.Read(buf[:])
	rnd := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf[:]))
	ts := time.Now().UnixMilli()
	return encodeBase36(uint64(ts)) + "-" + rnd
}

func encodeBase36(n uint64) string {
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = alphabet[n%36]
		n /= 36
	}
	return string(b[i:])
}
