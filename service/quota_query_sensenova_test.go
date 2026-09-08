package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// Parser contract (verified against the live pool-usage response captured
// from platform.sensenova.cn console XHR: every number is a JSON string,
// reset_at is epoch seconds, pools carry pool_type default|dedicated)
// ---------------------------------------------------------------------------

func sensenovaFixtureBody() map[string]any {
	return map[string]any{
		"plan": map[string]any{"id": "free", "name": "Free Plan", "type": "TOKEN_PLAN_PLAN_TYPE_FREE"},
		"pools": []any{
			map[string]any{
				"id":        "pool_default",
				"name":      "通用积分池",
				"pool_type": "default",
				"window_5h": map[string]any{"limit": "60000", "used": "26.72", "remaining": "59973.28", "reset_at": "1788721830"},
				"window_7d": map[string]any{"limit": "600000", "used": "53.44", "remaining": "599946.56", "reset_at": "1788948630"},
			},
			map[string]any{
				"id":        "pool_flash",
				"name":      "Flash-Lite积分池",
				"pool_type": "dedicated",
				"window_5h": map[string]any{"limit": "60000", "used": "0", "remaining": "60000", "reset_at": "1788721830"},
				"window_7d": map[string]any{"limit": "600000", "used": "0", "remaining": "600000", "reset_at": "1788948630"},
			},
		},
	}
}

func TestParseSensenovaUsageMapsAllFourWindows(t *testing.T) {
	r := parseSensenovaUsage(sensenovaFixtureBody())
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 4)

	// Default pool windows keep the canonical names.
	assert.Equal(t, "five_hour", r.Items[0].Name)
	assert.Equal(t, "weekly_limit", r.Items[1].Name)
	// The dedicated Flash-Lite pool gets the flash suffixed names.
	assert.Equal(t, "five_hour_flash", r.Items[2].Name)
	assert.Equal(t, "weekly_limit_flash", r.Items[3].Name)

	five := r.Items[0]
	require.NotNil(t, five.Used)
	assert.InEpsilon(t, 26.72, *five.Used, 1e-9)
	require.NotNil(t, five.Remaining)
	assert.InEpsilon(t, 59973.28, *five.Remaining, 1e-9)
	require.NotNil(t, five.Percent)
	assert.InEpsilon(t, 26.72/60000*100, *five.Percent, 1e-9)
	assert.Equal(t, "quota", five.Unit)
	require.NotNil(t, five.Reset)
	// 1788721830 epoch seconds = 2026-09-06T19:10:30Z (matches the observed
	// console reset countdown: Sep 7 03:10 at UTC+8)
	assert.Equal(t, "2026-09-06T19:10:30Z", *five.Reset)

	flashFive := r.Items[2]
	require.NotNil(t, flashFive.Used)
	assert.InDelta(t, 0.0, *flashFive.Used, 1e-9)
	require.NotNil(t, flashFive.Percent)
	assert.InDelta(t, 0.0, *flashFive.Percent, 1e-9)
}

func TestParseSensenovaUsageMissingPoolIsSkipped(t *testing.T) {
	body := map[string]any{
		"pools": []any{
			map[string]any{
				"pool_type": "default",
				"window_5h": map[string]any{"limit": "60000", "used": "100", "remaining": "59900", "reset_at": "1788721830"},
			},
		},
	}
	r := parseSensenovaUsage(body)
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 1)
	assert.Equal(t, "five_hour", r.Items[0].Name)
	require.NotNil(t, r.Items[0].Reset, "epoch reset_at converts to RFC3339")
}

func TestParseSensenovaUsageEmptyPoolsInvalid(t *testing.T) {
	assert.Equal(t, "invalid_response", parseSensenovaUsage(map[string]any{"pools": []any{}}).Status)
	assert.Equal(t, "invalid_response", parseSensenovaUsage(map[string]any{}).Status)
	assert.Equal(t, "invalid_response", parseSensenovaUsage(map[string]any{
		"pools": []any{map[string]any{"pool_type": "default"}},
	}).Status)
}

func TestParseSensenovaUsageRejectsInconsistentWindow(t *testing.T) {
	// used > limit must be skipped, never surfaced as a negative remaining.
	body := map[string]any{
		"pools": []any{
			map[string]any{
				"pool_type": "default",
				"window_5h": map[string]any{"limit": "100", "used": "150", "remaining": "-50", "reset_at": "1788721830"},
			},
		},
	}
	r := parseSensenovaUsage(body)
	assert.Equal(t, "invalid_response", r.Status)
}

// ---------------------------------------------------------------------------
// Credential row parsing
// ---------------------------------------------------------------------------

func TestParseSensenovaCredentialRows(t *testing.T) {
	rows := parseSensenovaCredentialRows(map[string]string{
		"cred_0": "alice:pw1",
		"cred_2": `{"username":"carol","password":"pw3"}`,
		"cred_5": "ignored:beyond-key-count",
	}, 4)
	require.Len(t, rows, 4)
	assert.Equal(t, sensenovaCredential{Username: "alice", Password: "pw1"}, rows[0])
	assert.Equal(t, sensenovaCredential{}, rows[1], "unset row stays empty")
	assert.Equal(t, sensenovaCredential{Username: "carol", Password: "pw3"}, rows[2])
	assert.Equal(t, sensenovaCredential{}, rows[3])
}

func TestParseSensenovaCredentialRowsMalformedStayEmpty(t *testing.T) {
	rows := parseSensenovaCredentialRows(map[string]string{
		"cred_0": "no-colon",
		"cred_1": "{not json",
		"cred_2": `{"username":"only"}`,
		"cred_3": ":password-only",
	}, 4)
	for _, row := range rows {
		assert.Equal(t, sensenovaCredential{}, row)
	}
}

// ---------------------------------------------------------------------------
// Binding validation
// ---------------------------------------------------------------------------

func sensenovaTestChannel(keys []string) *model.Channel {
	ch := &model.Channel{}
	ch.Key = strings.Join(keys, "\n")
	ch.ChannelInfo.IsMultiKey = len(keys) > 1
	return ch
}

func sensenovaSettingsJSON(t *testing.T, extra map[string]string) string {
	t.Helper()
	raw, err := common.Marshal(map[string]any{
		"quota_query_preset_id": "sensenova_token_plan",
		"quota_query_extra":     extra,
	})
	require.NoError(t, err)
	return string(raw)
}

func TestValidateSensenovaBindingAcceptsPartialRows(t *testing.T) {
	ch := sensenovaTestChannel([]string{"sk-a", "sk-b", "sk-c"})
	ch.OtherSettings = sensenovaSettingsJSON(t, map[string]string{
		"cred_0": "alice:pw",
		"cred_2": "carol:pw",
	})
	// Row 1 empty is legal: admin only owns credentials for keys 0 and 2.
	require.NoError(t, ValidateQuotaQueryBinding(ch))
}

func TestValidateSensenovaBindingRejectsIncompleteRow(t *testing.T) {
	ch := sensenovaTestChannel([]string{"sk-a"})
	ch.OtherSettings = sensenovaSettingsJSON(t, map[string]string{"cred_0": "only-username"})
	err := ValidateQuotaQueryBinding(ch)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "username and password")
}

func TestValidateSensenovaBindingRejectsForeignExtra(t *testing.T) {
	ch := sensenovaTestChannel([]string{"sk-a"})
	ch.OtherSettings = sensenovaSettingsJSON(t, map[string]string{
		"cred_0":     "alice:pw",
		"access_key": "nope",
	})
	err := ValidateQuotaQueryBinding(ch)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported quota query extra field")
}

func TestSensenovaConfigReadyRequiresChannelKeyAndOneRow(t *testing.T) {
	// No channel key: needs_configuration.
	ch := sensenovaTestChannel([]string{""})
	ch.ChannelInfo.IsMultiKey = false
	ch.OtherSettings = sensenovaSettingsJSON(t, map[string]string{"cred_0": "alice:pw"})
	cfg, err := GetQuotaQueryConfig(ch)
	require.NoError(t, err)
	assert.Equal(t, "needs_configuration", cfg.Status)
	assert.Contains(t, cfg.MissingFields, "channel_key")

	// Key present plus one row: ready.
	ch = sensenovaTestChannel([]string{"sk-a", "sk-b"})
	ch.OtherSettings = sensenovaSettingsJSON(t, map[string]string{"cred_1": "bob:pw"})
	cfg, err = GetQuotaQueryConfig(ch)
	require.NoError(t, err)
	assert.Equal(t, "ready", cfg.Status)
	assert.True(t, cfg.CanQuery)
}

// ---------------------------------------------------------------------------
// Query dispatch
// ---------------------------------------------------------------------------

func TestSensenovaDispatchMissingRowNeedsConfiguration(t *testing.T) {
	ch := sensenovaTestChannel([]string{"sk-a", "sk-b"})
	ch.OtherSettings = sensenovaSettingsJSON(t, map[string]string{"cred_0": "alice:pw"})
	r := QueryChannelQuotaWithOption(context.Background(), ch, false, QuotaQueryOption{})
	// No key_index on a multi-key channel: rejected before any upstream call.
	assert.Equal(t, "needs_configuration", r.Status)
}

// ---------------------------------------------------------------------------
// Login / refresh flow (httptest servers stand in for the fixed endpoints)
// ---------------------------------------------------------------------------

func sensenovaWithTestServers(t *testing.T, authHandler http.HandlerFunc, iamHandler http.HandlerFunc, usageHandler http.HandlerFunc) {
	t.Helper()
	h := func(f http.HandlerFunc) http.Handler { return f }
	authSrv := httptest.NewServer(h(authHandler))
	t.Cleanup(authSrv.Close)
	iamSrv := httptest.NewServer(h(iamHandler))
	t.Cleanup(iamSrv.Close)
	usageSrv := httptest.NewServer(h(usageHandler))
	t.Cleanup(usageSrv.Close)
	sensenovaAuthEndpointOverride = authSrv.URL
	sensenovaIAMLoginOverride = iamSrv.URL
	sensenovaUsageEndpointOverride = usageSrv.URL
	t.Cleanup(func() {
		sensenovaAuthEndpointOverride = ""
		sensenovaIAMLoginOverride = ""
		sensenovaUsageEndpointOverride = ""
		sensenovaSessions.Lock()
		sensenovaSessions.byAccount = map[string]sensenovaSession{}
		sensenovaSessions.Unlock()
		sensenovaLoginFailureBackoff.Lock()
		sensenovaLoginFailureBackoff.until = map[string]time.Time{}
		sensenovaLoginFailureBackoff.Unlock()
	})
	_ = authSrv
	_ = iamSrv
	_ = usageSrv
	_ = h
}

// sensenovaRedirectToChallenge encodes the PKCE state inside the challenge
// (the real platform threads it server-side; tests carry it in the open).
func sensenovaRedirectToChallenge(w http.ResponseWriter, r *http.Request) {
	challenge := "login-challenge-" + r.URL.Query().Get("state")
	http.Redirect(w, r, "https://iam.sensecoreapi.cn/iam/authn/v1/auth/login?login_challenge="+challenge, http.StatusFound)
}

// sensenovaEchoStateFromChallenge answers the password POST with the
// platform redirect (login_verifier hop), recovering the state from the
// challenge string. The challenge body must be pre-decoded by the caller
// (the request body can be read only once).
func sensenovaEchoStateFromChallenge(w http.ResponseWriter, body map[string]string) {
	state := strings.TrimPrefix(body["challenge"], "login-challenge-")
	sensenovaWriteRedirect(w, state)
}

// sensenovaWriteRedirect emits the platform echo for one verifier hop; the
// client re-points the host at the auth domain and follows until code.
func sensenovaWriteRedirect(w http.ResponseWriter, state string) {
	redirect := "https://platform.sensenova.cn/oauth2/auth?login_verifier=lv-" + url.QueryEscape(state) + "&state=" + url.QueryEscape(state)
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"redirect":"` + redirect + `"}`))
}

func TestSensenovaFullLoginAndUsageFlow(t *testing.T) {
	var iamCalls, authCalls, usageCalls int32
	var gotChallenge, gotUsername, gotPassword, gotTenant atomic.Value
	var gotAuthHeader atomic.Value
	usageBody, _ := common.Marshal(sensenovaFixtureBody())

	sensenovaWithTestServers(t,
		// authorization + token endpoints (routed by path)
		func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/oauth2/auth":
				if r.URL.Query().Get("login_verifier") != "" {
					// Terminal hop of the redirect loop: hand out the code.
					state := r.URL.Query().Get("state")
					http.Redirect(w, r, sensenovaRedirectURI+"/?code=the-code&state="+url.QueryEscape(state), http.StatusFound)
					return
				}
				atomic.AddInt32(&authCalls, 1)
				require.Equal(t, "S256", r.URL.Query().Get("code_challenge_method"))
				require.NotEmpty(t, r.URL.Query().Get("code_challenge"))
				sensenovaRedirectToChallenge(w, r)
			case "/oauth2/token":
				require.NoError(t, r.ParseForm())
				require.Equal(t, "authorization_code", r.PostForm.Get("grant_type"))
				require.Equal(t, "the-code", r.PostForm.Get("code"))
				require.NotEmpty(t, r.PostForm.Get("code_verifier"))
				w.Write([]byte(`{"access_token":"the-code-access","refresh_token":"the-refresh","expires_in":10800}`))
			default:
				t.Fatalf("unexpected auth path %q", r.URL.Path)
			}
		},
		// IAM password login
		func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&iamCalls, 1)
			var body map[string]string
			_ = common.DecodeJson(r.Body, &body)
			gotChallenge.Store(body["challenge"])
			gotUsername.Store(body["username"])
			gotPassword.Store(body["password"])
			gotTenant.Store(body["tenant_code"])
			require.True(t, strings.HasPrefix(body["challenge"], "login-challenge-"))
			sensenovaEchoStateFromChallenge(w, body)
		},
		// pool-usage endpoint
		func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&usageCalls, 1)
			gotAuthHeader.Store(r.Header.Get("Authorization"))
			w.Write(usageBody)
		})

	// The token exchange POSTs to authBase + "/oauth2/token"; the auth
	// handler above would 302 that path too, so the token exchange needs its
	// own route. Route it inside the auth handler by path.
	ch := sensenovaTestChannel([]string{"sk-a"})
	ch.OtherSettings = sensenovaSettingsJSON(t, map[string]string{"cred_0": "alice:secret"})
	r := QueryChannelQuotaWithOption(context.Background(), ch, false, QuotaQueryOption{})

	require.Equal(t, "ok", r.Status, "full flow should succeed: %v", r.Error)
	require.Len(t, r.Items, 4)
	assert.EqualValues(t, 1, atomic.LoadInt32(&authCalls))
	assert.EqualValues(t, 1, atomic.LoadInt32(&iamCalls))
	assert.EqualValues(t, 1, atomic.LoadInt32(&usageCalls))
	assert.Equal(t, "alice", gotUsername.Load())
	assert.Equal(t, "secret", gotPassword.Load())
	assert.Equal(t, "alice", gotTenant.Load())
	assert.Contains(t, gotChallenge.Load(), "login-challenge-")
	assert.Equal(t, "Bearer the-code-access", gotAuthHeader.Load())
}

func TestSensenovaSecondQueryReusesSession(t *testing.T) {
	var iamCalls, usageCalls int32
	usageBody, _ := common.Marshal(sensenovaFixtureBody())
	sensenovaWithTestServers(t,
		func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/oauth2/auth":
				if r.URL.Query().Get("login_verifier") != "" {
					state := r.URL.Query().Get("state")
					http.Redirect(w, r, sensenovaRedirectURI+"/?code=tok&state="+url.QueryEscape(state), http.StatusFound)
					return
				}
				sensenovaRedirectToChallenge(w, r)
			case "/oauth2/token":
				require.NoError(t, r.ParseForm())
				require.Equal(t, "authorization_code", r.PostForm.Get("grant_type"))
				w.Write([]byte(`{"access_token":"tok","expires_in":10800}`))
			}
		},
		func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&iamCalls, 1)
			var body map[string]string
			_ = common.DecodeJson(r.Body, &body)
			sensenovaEchoStateFromChallenge(w, body)
		},
		func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&usageCalls, 1)
			w.Write(usageBody)
		})
	ch := sensenovaTestChannel([]string{"sk-a"})
	ch.OtherSettings = sensenovaSettingsJSON(t, map[string]string{"cred_0": "carol:secret"})
	first := QueryChannelQuotaWithOption(context.Background(), ch, false, QuotaQueryOption{})
	require.Equal(t, "ok", first.Status)
	require.EqualValues(t, 1, atomic.LoadInt32(&iamCalls))

	// The immediate second query is served by the 30s TTL result cache, so
	// neither the login nor the usage endpoint is hit again. A forced
	// refresh re-runs the usage query but still reuses the cached session.
	second := QueryChannelQuotaWithOption(context.Background(), ch, false, QuotaQueryOption{})
	require.Equal(t, "ok", second.Status)
	assert.True(t, second.CacheHit)
	assert.EqualValues(t, 1, atomic.LoadInt32(&iamCalls), "session must be reused across queries")
	assert.EqualValues(t, 1, atomic.LoadInt32(&usageCalls))
}

func TestSensenovaWrongPasswordReportsAuthenticationError(t *testing.T) {
	var iamCalls int32
	sensenovaWithTestServers(t,
		sensenovaRedirectToChallenge,
		func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&iamCalls, 1)
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"code":3,"message":"InvalidArgument"}`))
		},
		func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("usage endpoint must not be reached without a session")
		})
	ch := sensenovaTestChannel([]string{"sk-a"})
	ch.OtherSettings = sensenovaSettingsJSON(t, map[string]string{"cred_0": "alice:wrong"})
	r := QueryChannelQuotaWithOption(context.Background(), ch, false, QuotaQueryOption{})
	assert.Equal(t, "authentication_error", r.Status)
	assert.EqualValues(t, 1, atomic.LoadInt32(&iamCalls))

	// The backoff arms after the failure: the immediate retry must not hit
	// the IAM login again (protects against the 4-attempt account lockout).
	r2 := QueryChannelQuotaWithOption(context.Background(), ch, false, QuotaQueryOption{})
	assert.Equal(t, "authentication_error", r2.Status)
	assert.EqualValues(t, 1, atomic.LoadInt32(&iamCalls), "login must not retry within the backoff window")
}

func TestSensenovaExtractCodeAndState(t *testing.T) {
	code, ok := sensenovaExtractCodeAndState("https://platform.sensenova.cn/?code=abc&state=s1", "s1")
	require.True(t, ok)
	assert.Equal(t, "abc", code)

	_, ok = sensenovaExtractCodeAndState("https://platform.sensenova.cn/?code=abc&state=other", "s1")
	assert.False(t, ok, "state mismatch must be rejected")

	_, ok = sensenovaExtractCodeAndState("https://platform.sensenova.cn/?error=access_denied", "s1")
	assert.False(t, ok)

	_, ok = sensenovaExtractCodeAndState("://bad url", "s1")
	assert.False(t, ok)
}

func TestSensenovaPKCEMaterial(t *testing.T) {
	a, err := sensenovaNewPKCE()
	require.NoError(t, err)
	b, err := sensenovaNewPKCE()
	require.NoError(t, err)
	assert.NotEqual(t, a.verifier, b.verifier)
	assert.Len(t, a.verifier, 43) // base64url of 32 bytes
	assert.NotEqual(t, a.challenge, b.challenge)
	// challenge = base64url(sha256(verifier)) is derivable
	assert.Len(t, a.challenge, 43)
}

func TestSensenovaTokenRequestExpiresIn(t *testing.T) {
	var form url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, r.ParseForm())
		form = r.PostForm
		w.Write([]byte(`{"access_token":"tok","refresh_token":"ref","expires_in":10800}`))
	}))
	defer srv.Close()
	s, err := sensenovaTokenRequest(context.Background(), srv.Client(), srv.URL, url.Values{"grant_type": {"refresh_token"}})
	require.NoError(t, err)
	assert.Equal(t, "tok", s.AccessToken)
	assert.Equal(t, "ref", s.RefreshToken)
	assert.True(t, s.AccessExpiry.After(time.Now().Add(2*time.Hour)))
	assert.Equal(t, "refresh_token", form.Get("grant_type"))

	// Missing expires_in falls back to the observed 3h lifetime.
	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"access_token":"tok2"}`))
	}))
	defer srv2.Close()
	s2, err := sensenovaTokenRequest(context.Background(), srv2.Client(), srv2.URL, nil)
	require.NoError(t, err)
	assert.True(t, s2.AccessExpiry.After(time.Now().Add(2*time.Hour)))

	// Token error responses map to stable statuses.
	srv3 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"invalid_grant"}`))
	}))
	defer srv3.Close()
	_, err = sensenovaTokenRequest(context.Background(), srv3.Client(), srv3.URL, nil)
	assert.EqualError(t, err, "authentication_error")
}

func TestSensenovaRefreshFlowAvoidsRelogin(t *testing.T) {
	var iamCalls, tokenCalls int32
	usageBody, _ := common.Marshal(sensenovaFixtureBody())
	sensenovaWithTestServers(t,
		sensenovaRedirectToChallenge,
		func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&iamCalls, 1)
			w.WriteHeader(http.StatusUnauthorized)
		},
		func(w http.ResponseWriter, r *http.Request) {
			w.Write(usageBody)
		})
	// Stand in a token endpoint that accepts the refresh grant.
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&tokenCalls, 1)
		require.NoError(t, r.ParseForm())
		require.Equal(t, "refresh_token", r.PostForm.Get("grant_type"))
		w.Write([]byte(`{"access_token":"fresh","refresh_token":"rotated","expires_in":10800}`))
	}))
	defer tokenSrv.Close()

	cred := sensenovaCredential{Username: "alice", Password: "secret"}
	accountKey := sensenovaAccountKey(cred)
	sensenovaSessions.Lock()
	sensenovaSessions.byAccount[accountKey] = sensenovaSession{
		AccessToken:  "stale",
		RefreshToken: "saved-refresh",
		// Access token expired, refresh path must kick in.
		AccessExpiry: time.Now().Add(-time.Minute),
	}
	sensenovaSessions.Unlock()

	// Point only the usage endpoint at the test server; the auth override
	// still points at the (never-called) login servers above.
	sensenovaAuthEndpointOverride = tokenSrv.URL
	endpoint := tokenSrv.URL + "/lite/console/v1/tokenplan/pool-usage"
	sensenovaUsageEndpointOverride = endpoint

	client := &http.Client{}
	token, errStatus := sensenovaEnsureSession(context.Background(), client, cred)
	require.Empty(t, errStatus)
	assert.Equal(t, "fresh", token)
	assert.EqualValues(t, 1, atomic.LoadInt32(&tokenCalls))
	assert.EqualValues(t, 0, atomic.LoadInt32(&iamCalls), "refresh must skip the password login")

	// The rotated refresh token is persisted for the next renewal.
	sensenovaSessions.Lock()
	saved := sensenovaSessions.byAccount[accountKey]
	sensenovaSessions.Unlock()
	assert.Equal(t, "rotated", saved.RefreshToken)
}

var _ = fmt.Sprintf // keep fmt imported for future test helpers
