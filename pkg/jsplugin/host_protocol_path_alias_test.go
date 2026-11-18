package jsplugin

import "testing"

// The Playground video endpoint is a session-authenticated alias of the OpenAI video
// protocol. Pinning must resolve it to /v1/videos, otherwise LookupEndpoint misses and
// type=61 task-plugin channels become unreachable from the video studio.
func TestResolveHostProtocolPath(t *testing.T) {
	cases := map[string]string{
		"/pg/videos":           "/v1/videos",
		"/v1/videos":           "/v1/videos",
		"/v1/responses":        "/v1/responses",
		"/pg/chat/completions": "/pg/chat/completions",
	}
	for in, want := range cases {
		if got := ResolveHostProtocolPath(in); got != want {
			t.Errorf("ResolveHostProtocolPath(%q) = %q, want %q", in, got, want)
		}
	}
}

// An aliased path must resolve to the same host protocol operation as its target,
// otherwise PinTaskPluginEndpoint cannot recognise it as a protocol path.
func TestAliasedPathResolvesHostProtocolOperation(t *testing.T) {
	wantName, wantOp, ok := LookupHostProtocolOperation("POST", "/v1/videos")
	if !ok {
		t.Fatal("POST /v1/videos must be a known host protocol operation")
	}
	name, op, ok := LookupHostProtocolOperation("POST", ResolveHostProtocolPath("/pg/videos"))
	if !ok {
		t.Fatal("aliased /pg/videos must resolve to a host protocol operation")
	}
	if name != wantName || op.Name != wantOp.Name || op.Path != wantOp.Path {
		t.Fatalf("alias resolved to %s.%s (%s), want %s.%s (%s)", name, op.Name, op.Path, wantName, wantOp.Name, wantOp.Path)
	}
}
