/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// SenseNova Token Plan usage queries the platform console gRPC-gateway:
// GET https://platform.sensenova.cn/lite/console/v1/tokenplan/pool-usage
// with the account's short-lived Hydra JWT (3h). The JWT is obtained by
// automating the console's own OAuth2 flow server-side: PKCE authorization
// request -> IAM password login -> authorization code -> token exchange,
// then renewed silently with the refresh token. The inference sk- key is
// rejected by these endpoints ("Authentication type 'apikey' is not
// enabled"), which is why credentials are account passwords.

const (
	sensenovaAuthBaseURL    = "https://signin.sensecore.cn"
	sensenovaIAMLoginURL    = "https://iam.sensecoreapi.cn/iam/authn/v1/auth/nova/login"
	sensenovaOAuthClientID  = "nova"
	sensenovaRedirectURI    = "https://platform.sensenova.cn"
	sensenovaScope          = "openid offline offline_access"
	sensenovaUsageOrigin    = "https://platform.sensenova.cn"
	sensenovaUsagePath      = "/lite/console/v1/tokenplan/pool-usage"
	sensenovaTokenMinExpiry = 5 * time.Minute
)

// Test-only endpoint overrides; production always uses the fixed endpoints.
var (
	sensenovaUsageEndpointOverride string
	sensenovaAuthEndpointOverride  string
	sensenovaIAMLoginOverride      string
)

// sensenovaCredential is one account row of the per-key credentials. Rows
// map 1:1 to the channel's keys by index.
type sensenovaCredential struct {
	Username string
	Password string
}

// parseSensenovaCredentialRows parses the quota_query_extra cred_N fields
// into rows aligned with the channel's key indexes (cred_0 -> key 0, ...).
// Accepted formats per row: "username:password" or a JSON object
// {"username":...,"password":...}. Empty rows stay empty on purpose: an
// admin may only own credentials for some of the channel's keys.
func parseSensenovaCredentialRows(extra map[string]string, keyCount int) []sensenovaCredential {
	rows := make([]sensenovaCredential, keyCount)
	for i := 0; i < keyCount; i++ {
		raw := strings.TrimSpace(extra[fmt.Sprintf("cred_%d", i)])
		if raw == "" {
			continue
		}
		if strings.HasPrefix(raw, "{") {
			var parsed struct {
				Username string `json:"username"`
				Password string `json:"password"`
			}
			if err := common.Unmarshal([]byte(raw), &parsed); err != nil {
				continue
			}
			if strings.TrimSpace(parsed.Username) == "" || parsed.Password == "" {
				// An incomplete row is treated as absent rather than
				// half-valid; binding validation reports it separately.
				continue
			}
			rows[i] = sensenovaCredential{Username: strings.TrimSpace(parsed.Username), Password: parsed.Password}
			continue
		}
		// First colon splits username:password; IAM usernames are
		// alphanumeric so a colon is unambiguous.
		if idx := strings.Index(raw, ":"); idx > 0 {
			rows[i] = sensenovaCredential{Username: strings.TrimSpace(raw[:idx]), Password: raw[idx+1:]}
		}
	}
	return rows
}

// sensenovaSession is one account's live OAuth2 session. Sessions live in
// memory only: after a restart the stored password re-logs-in silently.
type sensenovaSession struct {
	AccessToken  string
	RefreshToken string
	AccessExpiry time.Time
}

var sensenovaSessions = struct {
	sync.Mutex
	byAccount map[string]sensenovaSession
}{byAccount: map[string]sensenovaSession{}}

// sensenovaLoginFailureBackoff arms a per-account cooldown after a failed
// password login: the platform locks the account for 15 minutes after 4
// wrong attempts, so periodic quota scans must never hammer the IAM login.
var sensenovaLoginFailureBackoff = struct {
	sync.Mutex
	until map[string]time.Time
}{until: map[string]time.Time{}}

func sensenovaAccountKey(cred sensenovaCredential) string {
	sum := sha256.Sum256([]byte(cred.Username + "\x00" + cred.Password))
	return fmt.Sprintf("%x", sum)
}

func sensenovaSessionValid(s sensenovaSession) bool {
	return s.AccessToken != "" && time.Now().Add(sensenovaTokenMinExpiry).Before(s.AccessExpiry)
}

// sensenovaPKCE carries one authorization attempt's PKCE material.
type sensenovaPKCE struct {
	verifier  string
	challenge string
	state     string
}

func sensenovaNewPKCE() (sensenovaPKCE, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return sensenovaPKCE{}, err
	}
	verifier := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(verifier))
	stateRaw := make([]byte, 16)
	if _, err := rand.Read(stateRaw); err != nil {
		return sensenovaPKCE{}, err
	}
	return sensenovaPKCE{
		verifier:  verifier,
		challenge: base64.RawURLEncoding.EncodeToString(sum[:]),
		state:     base64.RawURLEncoding.EncodeToString(stateRaw),
	}, nil
}

// sensenovaExtractLoginChallenge pulls the login_challenge out of the 302
// Location of the authorization request.
func sensenovaExtractLoginChallenge(location string) string {
	u, err := url.Parse(location)
	if err != nil {
		return ""
	}
	return u.Query().Get("login_challenge")
}

// sensenovaExtractCodeAndState validates the state and extracts the
// authorization code from the login response's redirect field.
func sensenovaExtractCodeAndState(redirect, state string) (string, bool) {
	u, err := url.Parse(redirect)
	if err != nil {
		return "", false
	}
	if u.Query().Get("state") != state {
		return "", false
	}
	code := u.Query().Get("code")
	if code == "" {
		return "", false
	}
	return code, true
}

// sensenovaLogin performs the full password login against the NOVA platform
// endpoint (verified against the live console 2026-09):
//   1. PKCE authorization request -> 302 Location carries login_challenge
//   2. POST /iam/authn/v1/auth/nova/login -> 200 {redirect} where redirect
//      points at platform.sensenova.cn/oauth2/auth?...login_verifier=...
//   3. Follow the redirect loop on signin.sensecore.cn (the Hydra session
//      cookie lives there, so every platform.sensenova.cn hop must be
//      re-pointed at signin) until a Location carries code=<auth code>.
// Every URL is a fixed HTTPS identity; only the TCP targets are overridable
// for tests.
func sensenovaLogin(ctx context.Context, client *http.Client, cred sensenovaCredential) (sensenovaSession, error) {
	authBase := sensenovaAuthBaseURL
	if sensenovaAuthEndpointOverride != "" {
		authBase = sensenovaAuthEndpointOverride
	}
	iamLogin := sensenovaIAMLoginURL
	if sensenovaIAMLoginOverride != "" {
		iamLogin = sensenovaIAMLoginOverride
	}
	pkce, err := sensenovaNewPKCE()
	if err != nil {
		return sensenovaSession{}, err
	}
	// The Hydra authorization flow issues a CSRF session cookie on the first
	// request and requires it on every following hop (live-verified: without
	// the jar the loop ends in request_forbidden / No CSRF value available).
	jar, err := cookiejar.New(nil)
	if err != nil {
		return sensenovaSession{}, err
	}
	client.Jar = jar
	authURL := fmt.Sprintf("%s/oauth2/auth?response_type=code&client_id=%s&scope=%s&code_challenge=%s&code_challenge_method=S256&state=%s&prompt=login&redirect_uri=%s",
		authBase,
		url.QueryEscape(sensenovaOAuthClientID),
		url.QueryEscape(sensenovaScope),
		url.QueryEscape(pkce.challenge),
		url.QueryEscape(pkce.state),
		url.QueryEscape(sensenovaRedirectURI))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, authURL, nil)
	if err != nil {
		return sensenovaSession{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return sensenovaSession{}, fmt.Errorf("timeout")
		}
		return sensenovaSession{}, fmt.Errorf("network_error")
	}
	location := resp.Header.Get("Location")
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	resp.Body.Close()
	challenge := sensenovaExtractLoginChallenge(location)
	if challenge == "" {
		return sensenovaSession{}, fmt.Errorf("invalid_response")
	}

	loginBody, _ := common.Marshal(map[string]string{
		"challenge":   challenge,
		"tenant_code": cred.Username,
		"username":    cred.Username,
		"password":    cred.Password,
	})
	loginReq, err := http.NewRequestWithContext(ctx, http.MethodPost, iamLogin, strings.NewReader(string(loginBody)))
	if err != nil {
		return sensenovaSession{}, err
	}
	loginReq.Header.Set("Content-Type", "application/json")
	loginReq.Header.Set("Accept", "application/json")
	loginResp, err := client.Do(loginReq)
	if err != nil {
		if ctx.Err() != nil {
			return sensenovaSession{}, fmt.Errorf("timeout")
		}
		return sensenovaSession{}, fmt.Errorf("network_error")
	}
	const maxBody = 1 << 20
	raw, readErr := io.ReadAll(io.LimitReader(loginResp.Body, maxBody+1))
	loginResp.Body.Close()
	if readErr != nil {
		return sensenovaSession{}, fmt.Errorf("network_error")
	}
	if loginResp.StatusCode == http.StatusUnauthorized || loginResp.StatusCode == http.StatusForbidden {
		return sensenovaSession{}, fmt.Errorf("authentication_error")
	}
	if loginResp.StatusCode < 200 || loginResp.StatusCode >= 300 {
		return sensenovaSession{}, fmt.Errorf("upstream_error")
	}
	var loginResult struct {
		Redirect    string `json:"redirect"`
		RedirectURI string `json:"redirect_uri"`
		RedirectTo  string `json:"redirect_to"`
	}
	if err := common.Unmarshal(raw, &loginResult); err != nil {
		return sensenovaSession{}, fmt.Errorf("invalid_response")
	}
	redirect := loginResult.Redirect
	if redirect == "" {
		redirect = loginResult.RedirectURI
	}
	if redirect == "" {
		redirect = loginResult.RedirectTo
	}
	// Follow the login_verifier / consent_verifier redirect loop. The Hydra
	// session cookie is issued on the auth domain, but the platform echo
	// points each hop at the public console origin; re-pointing every hop at
	// the auth domain keeps the session (verified live: 3 hops then code).
	var code string
	for hop := 0; hop < 5 && redirect != ""; hop++ {
		redirect = sensenovaSwapToAuthHost(redirect)
		code = sensenovaFollowRedirectForCode(ctx, client, redirect, pkce.state)
		if code != "" {
			break
		}
		next, err := sensenovaPeekLocation(ctx, client, redirect)
		if err != nil {
			return sensenovaSession{}, err
		}
		redirect = next
	}
	if code == "" {
		return sensenovaSession{}, fmt.Errorf("invalid_response")
	}
	return sensenovaExchangeCode(ctx, client, authBase, code, pkce.verifier)
}

// sensenovaSwapToAuthHost re-points a platform console redirect at the auth
// domain so the Hydra session cookie (scoped to the auth host) is sent.
func sensenovaSwapToAuthHost(redirect string) string {
	authHost := sensenovaAuthBaseURL
	if sensenovaAuthEndpointOverride != "" {
		authHost = sensenovaAuthEndpointOverride
	}
	return strings.Replace(redirect, sensenovaUsageOrigin+"/", authHost+"/", 1)
}

// sensenovaFollowRedirectForCode issues GET and extracts code+state from the
// Location header when the loop reaches the terminal redirect.
func sensenovaFollowRedirectForCode(ctx context.Context, client *http.Client, redirect, state string) string {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, redirect, nil)
	if err != nil {
		return ""
	}
	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	location := resp.Header.Get("Location")
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	resp.Body.Close()
	code, ok := sensenovaExtractCodeAndState(location, state)
	if !ok {
		return ""
	}
	return code
}

// sensenovaPeekLocation GETs a redirect hop and returns its Location header.
func sensenovaPeekLocation(ctx context.Context, client *http.Client, redirect string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, redirect, nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("timeout")
		}
		return "", fmt.Errorf("network_error")
	}
	location := resp.Header.Get("Location")
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	resp.Body.Close()
	if location == "" {
		return "", fmt.Errorf("invalid_response")
	}
	return location, nil
}

// sensenovaExchangeCode swaps the authorization code for tokens.
func sensenovaExchangeCode(ctx context.Context, client *http.Client, authBase, code, verifier string) (sensenovaSession, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"code_verifier": {verifier},
		"client_id":     {sensenovaOAuthClientID},
		"redirect_uri":  {sensenovaRedirectURI},
	}
	return sensenovaTokenRequest(ctx, client, authBase+"/oauth2/token", form)
}

// sensenovaRefresh renews the access token with the refresh token.
func sensenovaRefresh(ctx context.Context, client *http.Client, authBase, refreshToken string) (sensenovaSession, error) {
	form := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {sensenovaOAuthClientID},
	}
	return sensenovaTokenRequest(ctx, client, authBase+"/oauth2/token", form)
}

// sensenovaTokenRequest posts a form-encoded token request and normalizes
// the response into a session.
func sensenovaTokenRequest(ctx context.Context, client *http.Client, endpoint string, form url.Values) (sensenovaSession, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return sensenovaSession{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return sensenovaSession{}, fmt.Errorf("timeout")
		}
		return sensenovaSession{}, fmt.Errorf("network_error")
	}
	const maxBody = 1 << 20
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	resp.Body.Close()
	if readErr != nil {
		return sensenovaSession{}, fmt.Errorf("network_error")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return sensenovaSession{}, fmt.Errorf("authentication_error")
		}
		return sensenovaSession{}, fmt.Errorf("upstream_error")
	}
	var token struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := common.Unmarshal(raw, &token); err != nil {
		return sensenovaSession{}, fmt.Errorf("invalid_response")
	}
	if token.AccessToken == "" {
		return sensenovaSession{}, fmt.Errorf("invalid_response")
	}
	expiresIn := time.Duration(token.ExpiresIn) * time.Second
	if token.ExpiresIn <= 0 {
		// Observed console lifetime; expires_in is normally present.
		expiresIn = 3 * time.Hour
	}
	return sensenovaSession{AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, AccessExpiry: time.Now().Add(expiresIn)}, nil
}

// sensenovaEnsureSession returns a usable access token for the account:
// cached session when fresh, refresh-token renewal next, full password login
// as the last resort. Login failures arm a 5-minute per-account backoff so
// periodic scans cannot trigger the platform's 4-attempt lockout.
func sensenovaEnsureSession(ctx context.Context, client *http.Client, cred sensenovaCredential) (string, string) {
	accountKey := sensenovaAccountKey(cred)
	authBase := sensenovaAuthBaseURL
	if sensenovaAuthEndpointOverride != "" {
		authBase = sensenovaAuthEndpointOverride
	}
	sensenovaLoginFailureBackoff.Lock()
	if until, armed := sensenovaLoginFailureBackoff.until[accountKey]; armed && time.Now().Before(until) {
		sensenovaLoginFailureBackoff.Unlock()
		return "", "authentication_error"
	}
	sensenovaLoginFailureBackoff.Unlock()

	sensenovaSessions.Lock()
	session := sensenovaSessions.byAccount[accountKey]
	sensenovaSessions.Unlock()
	if sensenovaSessionValid(session) {
		return session.AccessToken, ""
	}
	if session.RefreshToken != "" {
		if renewed, err := sensenovaRefresh(ctx, client, authBase, session.RefreshToken); err == nil {
			sensenovaStoreSession(accountKey, renewed)
			return renewed.AccessToken, ""
		}
	}
	newSession, err := sensenovaLogin(ctx, client, cred)
	if err != nil {
		switch msg := err.Error(); msg {
		case "authentication_error", "invalid_response":
			sensenovaLoginFailureBackoff.Lock()
			sensenovaLoginFailureBackoff.until[accountKey] = time.Now().Add(5 * time.Minute)
			sensenovaLoginFailureBackoff.Unlock()
			return "", msg
		default:
			return "", msg
		}
	}
	sensenovaStoreSession(accountKey, newSession)
	return newSession.AccessToken, ""
}

func sensenovaStoreSession(accountKey string, s sensenovaSession) {
	sensenovaSessions.Lock()
	sensenovaSessions.byAccount[accountKey] = s
	sensenovaSessions.Unlock()
}

// parseSensenovaUsage converts the pool-usage body into QuotaUsageItems:
// one item per pool window — the default pool's five_hour/weekly_limit plus
// the dedicated Flash-Lite pool's five_hour_flash/weekly_limit_flash. Every
// number arrives as a JSON string ("60000"); reset_at is epoch seconds.
// Windows of different pools are never summed or merged; a body with no
// recognizable window is invalid_response.
func parseSensenovaUsage(body map[string]any) QuotaUsage {
	pools := quotaArray(body["pools"])
	if len(pools) == 0 {
		return quotaResult("invalid_response")
	}
	r := quotaResult("ok")
	for _, raw := range pools {
		pool := quotaObject(raw)
		if pool == nil {
			continue
		}
		poolType, _ := pool["pool_type"].(string)
		if poolType == "" {
			poolType = "default"
		}
		for _, w := range []struct{ key, name string }{
			{"window_5h", "five_hour"},
			{"window_7d", "weekly_limit"},
		} {
			win := quotaObject(pool[w.key])
			if win == nil {
				continue
			}
			limit := quotaNumber(win["limit"])
			used := quotaNumber(win["used"])
			if limit == nil || used == nil || *limit <= 0 || *used < 0 || *used > *limit {
				continue
			}
			u := *used
			rem := *limit - *used
			if remaining := quotaNumber(win["remaining"]); remaining != nil && *remaining >= 0 && *remaining <= *limit {
				rem = *remaining
			}
			pct := u / *limit * 100
			// reset_at arrives as an epoch-seconds JSON string; convert via
			// quotaNumber (string->float64) before the timestamp conversion.
			var reset *string
			if resetSecs := quotaNumber(win["reset_at"]); resetSecs != nil {
				reset = quotaReset(*resetSecs, false)
			}
			item := QuotaUsageItem{Name: w.name, Used: &u, Remaining: &rem, Percent: &pct, Reset: reset, Unit: "quota"}
			if poolType == "dedicated" {
				if w.name == "five_hour" {
					item.Name = "five_hour_flash"
				} else {
					item.Name = "weekly_limit_flash"
				}
			}
			r.Items = append(r.Items, item)
		}
	}
	if len(r.Items) == 0 {
		return quotaResult("invalid_response")
	}
	return r
}

// querySensenovaUsage queries one account's pool usage with a valid session.
func querySensenovaUsage(ctx context.Context, client *http.Client, cred sensenovaCredential) QuotaUsage {
	token, errStatus := sensenovaEnsureSession(ctx, client, cred)
	if errStatus != "" {
		return quotaResult(errStatus)
	}
	endpoint := sensenovaUsageOrigin + sensenovaUsagePath
	if sensenovaUsageEndpointOverride != "" {
		endpoint = sensenovaUsageEndpointOverride
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return quotaResult("needs_configuration")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return quotaResult("timeout")
		}
		return quotaResult("network_error")
	}
	if resp.StatusCode == http.StatusUnauthorized {
		// The JWT may have been revoked server-side; drop the cached session
		// so the next attempt re-authenticates.
		accountKey := sensenovaAccountKey(cred)
		sensenovaSessions.Lock()
		delete(sensenovaSessions.byAccount, accountKey)
		sensenovaSessions.Unlock()
		resp.Body.Close()
		return quotaResult("authentication_error")
	}
	body, status := readQuotaBody(resp)
	if status != "" {
		return quotaResult(status)
	}
	var data map[string]any
	if common.Unmarshal(body, &data) != nil {
		return quotaResult("invalid_response")
	}
	return parseSensenovaUsage(data)
}
