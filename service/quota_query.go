package service

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"golang.org/x/sync/singleflight"
)

// Query status values (stable API contract):
// ok, disabled, unresolved, unsupported, needs_configuration,
// authentication_error, rate_limited, timeout, network_error,
// upstream_error, response_too_large, invalid_response, cancelled.

// Contracts follow cc-switch db41d701879592b8eca938cbe5c5ac28dd732b9f
// (coding_plan quota service) and the ZenMux platform API docs
// (GET /api/v1/management/subscription/detail). Amounts are null when
// providers expose only percentages; independently resetting windows must
// never be summed.
type QuotaUsageItem struct {
	Name      string   `json:"name"`
	Used      *float64 `json:"used"`
	Remaining *float64 `json:"remaining"`
	Percent   *float64 `json:"percent"`
	Reset     *string  `json:"reset"`
	// Unit qualifies the used/remaining amounts: "usd" for ZenMux plan
	// dollars, "quota" for provider-specific plan units (Kimi requests,
	// volcengine AFP points). Empty means percent-only information.
	Unit string `json:"unit,omitempty"`
}
type QuotaUsage struct {
	Status    string           `json:"status"`
	Items     []QuotaUsageItem `json:"items"`
	FetchedAt string           `json:"fetched_at"`
	Error     *string          `json:"error"`
	// CacheHit is true when this response was served from the TTL cache
	// instead of a fresh upstream query. Explicit, so clients never have to
	// infer staleness from timestamps.
	CacheHit bool `json:"cache_hit"`
}
type quotaCacheEntry struct {
	result  QuotaUsage
	expires time.Time
}
type quotaQueryCache struct {
	mu      sync.Mutex
	entries map[string]quotaCacheEntry
	flight  singleflight.Group
	slots   chan struct{}
}

var channelQuotaCache = quotaQueryCache{entries: make(map[string]quotaCacheEntry), slots: make(chan struct{}, 8)}

const quotaQueryHTTPTimeout = 15 * time.Second

// QuotaQueryOption carries per-request, non-persisted overrides (currently
// key_index). They never mutate channel settings.
type QuotaQueryOption struct {
	KeyIndex *int
}

func quotaResult(status string) QuotaUsage {
	r := QuotaUsage{Status: status, Items: []QuotaUsageItem{}, FetchedAt: time.Now().UTC().Format(time.RFC3339)}
	if status != "ok" {
		r.Error = &status
	}
	return r
}

func quotaErrorResult(status, message string) QuotaUsage {
	r := quotaResult(status)
	r.Error = &message
	return r
}

func QueryChannelQuota(ctx context.Context, ch *model.Channel, refresh bool) QuotaUsage {
	return QueryChannelQuotaWithOption(ctx, ch, refresh, QuotaQueryOption{})
}

func QueryChannelQuotaWithOption(ctx context.Context, ch *model.Channel, refresh bool, opt QuotaQueryOption) QuotaUsage {
	// The override (when provided) is validated against the key count inside
	// this call; on error the request is malformed and rejected.
	cfg, err := GetQuotaQueryConfigWithOption(ch, opt)
	if err != nil {
		return quotaResult("needs_configuration")
	}
	if !cfg.CanQuery {
		return quotaResult(cfg.Status)
	}
	// Resolve the credential: either the referenced dedicated credential
	// channel's key, or this channel's own key (selected by index for
	// multi-key channels).
	var key string
	otherSettings, parseErr := ParseQuotaQuerySettings(ch.OtherSettings)
	if parseErr != nil {
		return quotaResult("needs_configuration")
	}
	if otherSettings.QuotaQueryCredentialChannelID != nil {
		ref, refErr := ResolveQuotaQueryCredentialChannel(otherSettings)
		if refErr != nil || ref == nil || strings.TrimSpace(ref.Key) == "" {
			return quotaResult("needs_configuration")
		}
		key = strings.TrimSpace(ref.Key)
		if strings.ContainsAny(key, "\r\n") {
			return quotaResult("needs_configuration")
		}
	} else {
		keyIndex := cfg.KeyIndex
		key = ch.Key
		if ch.ChannelInfo.IsMultiKey {
			if keyIndex == nil {
				return quotaResult("needs_configuration")
			}
			keys := ch.GetKeys()
			if *keyIndex < 0 || *keyIndex >= len(keys) {
				return quotaResult("needs_configuration")
			}
			key = keys[*keyIndex]
		}
		key = strings.TrimSpace(key)
		if key == "" || strings.ContainsAny(key, "\r\n") {
			return quotaResult("needs_configuration")
		}
	}
	settings := ch.GetSetting()
	// Hash identity material so cache keys contain no plaintext credentials.
	identity, _ := common.Marshal([]any{ch.Id, key, cfg.ResolvedPresetID, cfg.KeyIndex, cfg.Extra, settings.Proxy})
	cacheKey := fmt.Sprintf("%x", sha256.Sum256(identity))
	cache := &channelQuotaCache
	cache.mu.Lock()
	entry, found := cache.entries[cacheKey]
	cache.mu.Unlock()
	if !refresh && found && time.Now().Before(entry.expires) {
		r := entry.result
		r.CacheHit = true
		return r
	}
	result := cache.flight.DoChan(cacheKey, func() (any, error) {
		// Detached bounded lifetime: cancelling one caller must not cancel other waiters.
		requestCtx, cancel := context.WithTimeout(context.Background(), quotaQueryHTTPTimeout)
		defer cancel()
		select {
		case cache.slots <- struct{}{}:
			defer func() { <-cache.slots }()
		case <-requestCtx.Done():
			return quotaResult("timeout"), nil
		}
		base, err := GetHttpClientWithProxySettings(settings.Proxy, settings)
		if err != nil {
			return quotaResult("needs_configuration"), nil
		}
		client := *base
		client.Timeout = quotaQueryHTTPTimeout
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		var r QuotaUsage
		if cfg.ResolvedPresetID == "volcengine_coding_plan" {
			cred, credErr := parseVolcengineCredential(key)
			if credErr != nil {
				r = quotaErrorResult("needs_configuration", "credential channel key must be JSON with access_key_id and secret_access_key")
			} else {
				r = queryVolcengineUsage(requestCtx, &client, ch.GetBaseURL(), *cred)
			}
		} else if cfg.ResolvedPresetID == "new_api_subscription" {
			r = queryNewApiSubscriptionUsage(requestCtx, &client, ch.GetBaseURL(), cfg.Extra)
		} else {
			r = fetchQuotaUsage(requestCtx, &client, cfg, QuotaQueryCredential{Key: key})
		}
		cache.mu.Lock()
		now := time.Now()
		for k, e := range cache.entries {
			if !now.Before(e.expires) {
				delete(cache.entries, k)
			}
		}
		// Bounded memory even when many distinct channels are queried within one TTL.
		if len(cache.entries) >= 1024 {
			clear(cache.entries)
		}
		cache.entries[cacheKey] = quotaCacheEntry{r, now.Add(30 * time.Second)}
		cache.mu.Unlock()
		return r, nil
	})
	select {
	case <-ctx.Done():
		return quotaResult("cancelled")
	case r := <-result:
		return r.Val.(QuotaUsage)
	}
}

// QuotaQueryCredential carries the credential used for one upstream query.
// For channel_key presets it is the channel API key (or the dedicated key
// from a referenced credential channel); volcengine AK/SK JSON flows through
// the same field and is parsed by the volcengine adapter.
type QuotaQueryCredential struct {
	Key string
}

// quotaUsageEndpoints maps presets to fixed HTTPS identities, never
// constructed from channel base URLs. Production code never mutates it.
var quotaUsageEndpoints = map[string]string{
	"glm_coding_plan_cn":       "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
	"glm_coding_plan_intl":     "https://api.z.ai/api/monitor/usage/quota/limit",
	"glm_coding_plan_team":     "https://open.bigmodel.cn/api/monitor/usage/quota/limit?type=2",
	"kimi_coding_plan":         "https://api.kimi.com/coding/v1/usages",
	"minimax_coding_plan_cn":   "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
	"minimax_coding_plan_intl": "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
	"opencode_go":              "https://opencode.ai/zen/go/v1/usage",
}

// zenmuxUsageEndpoint is the documented, fixed identity of the ZenMux
// subscription usage API. It only accepts Management API keys.
const zenmuxUsageEndpoint = "https://zenmux.ai/api/v1/management/subscription/detail"

// zenmuxUsageEndpointOverride and volcUsageEndpointOverride are test-only;
// production always uses the fixed endpoints above.
var (
	zenmuxUsageEndpointOverride string
	volcUsageEndpointOverride   string
)

// Endpoints are fixed HTTPS identities, never constructed from channel base
// URLs. Redirects are disabled by the caller so credentials cannot migrate to
// another host.
func fetchQuotaUsage(ctx context.Context, client *http.Client, cfg QuotaQueryConfig, cred QuotaQueryCredential) QuotaUsage {
	if cfg.ResolvedPresetID == "zenmux" {
		return queryZenMuxUsage(ctx, client, cred.Key)
	}
	endpoint := quotaUsageEndpoints[cfg.ResolvedPresetID]
	if endpoint == "" {
		return quotaResult("unsupported")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return quotaResult("needs_configuration")
	}
	auth := "Bearer " + cred.Key
	if strings.HasPrefix(cfg.ResolvedPresetID, "glm_") {
		// Zhipu does not accept the Bearer prefix on this endpoint.
		auth = cred.Key
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Accept", "application/json")
	if cfg.ResolvedPresetID == "glm_coding_plan_team" {
		req.Header.Set("bigmodel-organization", cfg.Extra["organization_id"])
		req.Header.Set("bigmodel-project", cfg.Extra["project_id"])
	}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return quotaResult("timeout")
		}
		return quotaResult("network_error")
	}
	body, status := readQuotaBody(resp)
	if status != "" {
		return quotaResult(status)
	}
	var data map[string]any
	if common.Unmarshal(body, &data) != nil {
		return quotaResult("invalid_response")
	}
	return parseQuotaUsage(cfg.ResolvedPresetID, data)
}

// readQuotaBody classifies transport/HTTP failures. The returned error string
// is a stable status; an empty string means the body is ready to parse.
func readQuotaBody(resp *http.Response) ([]byte, string) {
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == 401 || resp.StatusCode == 403:
		return nil, "authentication_error"
	case resp.StatusCode == 429:
		return nil, "rate_limited"
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		return nil, "upstream_error"
	}
	const maxBody = 1 << 20
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return nil, "network_error"
	}
	if len(body) > maxBody {
		return nil, "response_too_large"
	}
	return body, ""
}

// zenmuxAllowedHosts guards the endpoint: it is a fixed URL, and this check
// makes accidental relocation detectable rather than silently trusted.
var zenmuxAllowedHosts = map[string]bool{"zenmux.ai": true, "127.0.0.1": true, "localhost": true}

func queryZenMuxUsage(ctx context.Context, client *http.Client, key string) QuotaUsage {
	endpoint := zenmuxUsageEndpoint
	if zenmuxUsageEndpointOverride != "" {
		endpoint = zenmuxUsageEndpointOverride
	}
	u, err := url.Parse(endpoint)
	if err != nil || !zenmuxAllowedHosts[u.Hostname()] || (u.Scheme != "https" && u.Scheme != "http") {
		return quotaResult("unsupported")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return quotaResult("needs_configuration")
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return quotaResult("timeout")
		}
		return quotaResult("network_error")
	}
	body, status := readQuotaBody(resp)
	if status != "" {
		return quotaResult(status)
	}
	var data map[string]any
	if common.Unmarshal(body, &data) != nil {
		return quotaResult("invalid_response")
	}
	return parseZenMuxUsage(data)
}

func quotaNumber(v any) *float64 {
	var n float64
	switch v := v.(type) {
	case float64:
		n = v
	case string:
		var err error
		n, err = strconv.ParseFloat(v, 64)
		if err != nil {
			return nil
		}
	default:
		return nil
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return nil
	}
	return &n
}
func quotaReset(v any, millis bool) *string {
	var t time.Time
	if s, ok := v.(string); ok {
		var err error
		t, err = time.Parse(time.RFC3339, s)
		if err != nil {
			return nil
		}
	} else {
		n := quotaNumber(v)
		if n == nil || *n <= 0 || *n > 253402300799000 {
			return nil
		}
		if millis || *n >= 1e12 {
			t = time.UnixMilli(int64(*n))
		} else {
			t = time.Unix(int64(*n), 0)
		}
	}
	if t.Year() < 1 || t.Year() > 9999 {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}
func quotaObject(v any) map[string]any { m, _ := v.(map[string]any); return m }
func quotaArray(v any) []any           { a, _ := v.([]any); return a }

// parseQuotaUsage parses non-ZenMux bodies; each branch mirrors the verified
// cc-switch parser at db41d701.
func parseQuotaUsage(preset string, body map[string]any) QuotaUsage {
	r := quotaResult("ok")
	if body["success"] == false || body["error"] != nil {
		return quotaResult("upstream_error")
	}
	if base := quotaObject(body["base_resp"]); base != nil {
		code := quotaNumber(base["status_code"])
		if code == nil || *code != 0 {
			return quotaResult("upstream_error")
		}
	}
	switch {
	case strings.HasPrefix(preset, "glm_"):
		data := quotaObject(body["data"])
		if data == nil {
			return quotaResult("invalid_response")
		}
		fiveHour, weekly := parseZhipuTokenTiers(data)
		if fiveHour != nil {
			r.Items = append(r.Items, *fiveHour)
		}
		if weekly != nil {
			r.Items = append(r.Items, *weekly)
		}
	case preset == "kimi_coding_plan":
		windows := []struct {
			name string
			data map[string]any
		}{}
		for _, raw := range quotaArray(body["limits"]) {
			windows = append(windows, struct {
				name string
				data map[string]any
			}{"five_hour", quotaObject(quotaObject(raw)["detail"])})
		}
		windows = append(windows, struct {
			name string
			data map[string]any
		}{"weekly_limit", quotaObject(body["usage"])})
		for _, w := range windows {
			limit, remaining := quotaNumber(w.data["limit"]), quotaNumber(w.data["remaining"])
			if limit == nil || remaining == nil || *limit <= 0 || *remaining > *limit {
				continue
			}
			used := *limit - *remaining
			p := used / *limit * 100
			r.Items = append(r.Items, QuotaUsageItem{Name: w.name, Used: &used, Remaining: remaining, Percent: &p, Reset: quotaReset(w.data["resetTime"], false), Unit: "quota"})
		}
	case strings.HasPrefix(preset, "minimax_"):
		for _, raw := range quotaArray(body["model_remains"]) {
			item := quotaObject(raw)
			if name, _ := item["model_name"].(string); name != "general" {
				continue
			}
			// current_*_remaining_percent is REMAINING percent (0-100);
			// utilization = 100 - remaining. Weekly tier only exists when
			// current_weekly_status == 1 (status 3 means the plan has no
			// weekly limit and remaining is pinned at 100).
			for _, w := range []struct {
				name, percent, reset string
				weekly               bool
			}{
				{"five_hour", "current_interval_remaining_percent", "end_time", false},
				{"weekly_limit", "current_weekly_remaining_percent", "weekly_end_time", true},
			} {
				if w.weekly {
					s := quotaNumber(item["current_weekly_status"])
					if s == nil || *s != 1 {
						continue
					}
				}
				remain := quotaNumber(item[w.percent])
				if remain == nil {
					continue
				}
				p := 100 - *remain
				r.Items = append(r.Items, QuotaUsageItem{Name: w.name, Percent: &p, Reset: quotaReset(item[w.reset], true)})
			}
			break
		}
	case preset == "opencode_go":
		// percent is 0-100 used; percent==0 makes upstream resetsAt a
		// placeholder (window start + duration), so it is dropped.
		for _, w := range []struct{ key, name string }{{"rolling", "five_hour"}, {"weekly", "weekly_limit"}, {"monthly", "monthly"}} {
			item := quotaObject(quotaObject(body["usage"])[w.key])
			p := quotaNumber(item["percent"])
			if p == nil {
				continue
			}
			var reset *string
			if *p > 0 {
				reset = quotaReset(item["resetsAt"], false)
			}
			r.Items = append(r.Items, QuotaUsageItem{Name: w.name, Percent: p, Reset: reset})
		}
	default:
		return quotaResult("unsupported")
	}
	if len(r.Items) == 0 {
		return quotaResult("invalid_response")
	}
	return r
}

// parseZhipuTokenTiers classifies Zhipu TOKENS_LIMIT/CREDIT_LIMIT entries.
// Priority 1: the explicit `unit` field (3 = five-hour window, 6 = weekly);
// number variants like (6,1) are weekly too, so only unit is anchored.
// Priority 2 (unit missing/unrecognized): entries without nextResetTime
// prefer five_hour, the rest fill remaining slots in reset-time ascending
// order. At most two entries are kept. Percentages pass through unclamped.
func parseZhipuTokenTiers(data map[string]any) (*QuotaUsageItem, *QuotaUsageItem) {
	type entry struct {
		reset *float64
		pct   *float64
		iso   *string
	}
	var fiveHour, weekly *entry
	var unclassified []entry
	for _, raw := range quotaArray(data["limits"]) {
		item := quotaObject(raw)
		limitType, _ := item["type"].(string)
		if !strings.EqualFold(limitType, "TOKENS_LIMIT") && !strings.EqualFold(limitType, "CREDIT_LIMIT") {
			continue
		}
		e := entry{reset: quotaNumber(item["nextResetTime"]), pct: quotaNumber(item["percentage"]), iso: nil}
		if e.reset != nil {
			iso := quotaReset(item["nextResetTime"], true)
			e.iso = iso
		}
		unit := quotaNumber(item["unit"])
		switch {
		case unit != nil && *unit == 3 && fiveHour == nil:
			cp := e
			fiveHour = &cp
		case unit != nil && *unit == 6 && weekly == nil:
			cp := e
			weekly = &cp
		default:
			unclassified = append(unclassified, e)
		}
	}
	// Sort unclassified: entries without reset first, then by reset time.
	for i := 1; i < len(unclassified); i++ {
		for j := i; j > 0; j-- {
			a, b := unclassified[j-1], unclassified[j]
			aKey, bKey := 0, 0
			aVal, bVal := 0.0, 0.0
			if a.reset != nil {
				aKey, aVal = 1, *a.reset
			}
			if b.reset != nil {
				bKey, bVal = 1, *b.reset
			}
			if aKey < bKey || (aKey == bKey && aVal <= bVal) {
				break
			}
			unclassified[j-1], unclassified[j] = unclassified[j], unclassified[j-1]
		}
	}
	for _, e := range unclassified {
		if fiveHour == nil {
			cp := e
			fiveHour = &cp
		} else if weekly == nil {
			cp := e
			weekly = &cp
		}
	}
	toItem := func(name string, e *entry) *QuotaUsageItem {
		if e == nil {
			return nil
		}
		return &QuotaUsageItem{Name: name, Percent: e.pct, Reset: e.iso}
	}
	return toItem("five_hour", fiveHour), toItem("weekly_limit", weekly)
}

// parseZenMuxUsage parses the documented subscription detail body.
// usage_percentage is a 0..1 fraction; percent = fraction * 100. used/max USD
// amounts are surfaced when present. A missing quota window is skipped; a
// body without any recognizable window is invalid_response.
func parseZenMuxUsage(body map[string]any) QuotaUsage {
	if success, ok := body["success"].(bool); ok && !success {
		msg, _ := body["message"].(string)
		if msg == "" {
			if e, ok := body["error"].(string); ok {
				msg = e
			}
		}
		return quotaErrorResult("upstream_error", "upstream_error: "+msg)
	}
	data := quotaObject(body["data"])
	if data == nil {
		return quotaResult("invalid_response")
	}
	r := quotaResult("ok")
	for _, w := range []struct{ key, name string }{{"quota_5_hour", "five_hour"}, {"quota_7_day", "weekly_limit"}, {"quota_monthly", "monthly"}} {
		item := quotaObject(data[w.key])
		if item == nil {
			continue
		}
		frac := quotaNumber(item["usage_percentage"])
		if frac == nil {
			// quota_monthly has no real-time usage; surface the plan cap as
			// amounts-only when available.
			used, maxUsed := quotaNumber(item["used_value_usd"]), quotaNumber(item["max_value_usd"])
			if used == nil && maxUsed == nil {
				continue
			}
			r.Items = append(r.Items, QuotaUsageItem{Name: w.name, Used: used, Remaining: nil, Percent: nil, Reset: nil})
			continue
		}
		p := *frac * 100
		item2 := QuotaUsageItem{Name: w.name, Percent: &p, Reset: quotaReset(item["resets_at"], false), Unit: "usd"}
		if used := quotaNumber(item["used_value_usd"]); used != nil {
			item2.Used = used
		}
		if maxUsed := quotaNumber(item["max_value_usd"]); maxUsed != nil {
			rem := *maxUsed
			if item2.Used != nil {
				rem = *maxUsed - *item2.Used
			}
			item2.Remaining = &rem
		}
		r.Items = append(r.Items, item2)
	}
	if len(r.Items) == 0 {
		return quotaResult("invalid_response")
	}
	return r
}

// parseQuotaStatusMessage renders a human-readable summary line used by admin
// surfaces that show a single string (logs, audit). Safe for API responses:
// never includes credentials or raw upstream bodies.
func parseQuotaStatusMessage(u QuotaUsage) string {
	if u.Status == "ok" {
		names := make([]string, 0, len(u.Items))
		for _, item := range u.Items {
			names = append(names, item.Name)
		}
		return "ok: " + strings.Join(names, ",")
	}
	if u.Error != nil {
		return *u.Error
	}
	return u.Status
}
