package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// Parser contracts (verified against cc-switch db41d701 and ZenMux docs)
// ---------------------------------------------------------------------------

func TestParseMiniMaxRemainingPercentSemantics(t *testing.T) {
	// current_*_remaining_percent is REMAINING (0-100); utilization = 100 - remaining.
	// Only model_name == "general" is read; weekly requires current_weekly_status == 1.
	body := map[string]any{
		"model_remains": []any{
			map[string]any{
				"model_name":                         "video",
				"current_interval_remaining_percent": 50.0,
				"current_weekly_remaining_percent":   50.0,
			},
			map[string]any{
				"model_name":                         "general",
				"current_interval_remaining_percent": 98.0,
				"current_weekly_remaining_percent":   95.0,
				"current_weekly_status":              1.0,
				"end_time":                           1780329600000.0,
				"weekly_end_time":                    1780848000000.0,
			},
		},
		"base_resp": map[string]any{"status_code": 0.0, "status_msg": "success"},
	}
	r := parseQuotaUsage("minimax_coding_plan_cn", body)
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 2)
	assert.Equal(t, "five_hour", r.Items[0].Name)
	require.NotNil(t, r.Items[0].Percent)
	assert.InEpsilon(t, 2.0, *r.Items[0].Percent, 1e-9) // 100 - 98
	require.NotNil(t, r.Items[0].Reset)
	assert.Equal(t, "weekly_limit", r.Items[1].Name)
	require.NotNil(t, r.Items[1].Percent)
	assert.InEpsilon(t, 5.0, *r.Items[1].Percent, 1e-9) // 100 - 95
}

func TestParseMiniMaxWeeklyStatusNotActiveSkipsWeekly(t *testing.T) {
	// status=3 means no weekly limit; remaining pinned at 100 must not
	// surface a fake "0% used" weekly tier.
	body := map[string]any{
		"model_remains": []any{
			map[string]any{
				"model_name":                         "general",
				"current_interval_remaining_percent": 99.0,
				"current_weekly_status":              3.0,
				"current_weekly_remaining_percent":   100.0,
				"end_time":                           1780365600000.0,
			},
		},
	}
	r := parseQuotaUsage("minimax_coding_plan_intl", body)
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 1)
	assert.Equal(t, "five_hour", r.Items[0].Name)
	assert.InEpsilon(t, 1.0, *r.Items[0].Percent, 1e-9)
}

func TestParseZhipuUnitFieldClassifiesWindows(t *testing.T) {
	// unit=3 -> five_hour, unit=6 -> weekly regardless of reset order
	// (issue #3036: weekly can reset sooner than the 5h bucket).
	data := map[string]any{
		"limits": []any{
			map[string]any{"type": "TOKENS_LIMIT", "unit": 6.0, "number": 7.0, "percentage": 42.0, "nextResetTime": 1000003600000.0},
			map[string]any{"type": "TOKENS_LIMIT", "unit": 3.0, "number": 5.0, "percentage": 1.0, "nextResetTime": 1000018000000.0},
		},
	}
	r := parseQuotaUsage("glm_coding_plan_cn", map[string]any{"data": data})
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 2)
	assert.Equal(t, "five_hour", r.Items[0].Name)
	assert.InEpsilon(t, 1.0, *r.Items[0].Percent, 1e-9)
	assert.Equal(t, "weekly_limit", r.Items[1].Name)
	assert.InEpsilon(t, 42.0, *r.Items[1].Percent, 1e-9)
}

func TestParseZhipuUnclassifiedEntriesOrderByReset(t *testing.T) {
	// Without unit: entry without reset prefers five_hour; others fill
	// slots in reset ascending order.
	data := map[string]any{
		"limits": []any{
			map[string]any{"type": "TOKENS_LIMIT", "percentage": 25.0, "nextResetTime": 2000000000000.0},
			map[string]any{"type": "TOKENS_LIMIT", "percentage": 0.0},
		},
	}
	r := parseQuotaUsage("glm_coding_plan_intl", map[string]any{"data": data})
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 2)
	assert.Equal(t, "five_hour", r.Items[0].Name)
	assert.InDelta(t, 0.0, *r.Items[0].Percent, 1e-9)
	assert.Nil(t, r.Items[0].Reset)
	assert.Equal(t, "weekly_limit", r.Items[1].Name)
	assert.InEpsilon(t, 25.0, *r.Items[1].Percent, 1e-9)
}

func TestParseKimiLimitRemainingToUsed(t *testing.T) {
	body := map[string]any{
		"limits": []any{
			map[string]any{"detail": map[string]any{"limit": 100.0, "remaining": 70.0, "resetTime": 1780329600.0}},
		},
		"usage": map[string]any{"limit": 200.0, "remaining": 120.0, "resetTime": 1780848000.0},
	}
	r := parseQuotaUsage("kimi_coding_plan", body)
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 2)
	assert.Equal(t, "five_hour", r.Items[0].Name)
	require.NotNil(t, r.Items[0].Used)
	assert.InEpsilon(t, 30.0, *r.Items[0].Used, 1e-9)
	require.NotNil(t, r.Items[0].Percent)
	assert.InEpsilon(t, 30.0, *r.Items[0].Percent, 1e-9)
	require.NotNil(t, r.Items[0].Remaining)
	assert.InEpsilon(t, 70.0, *r.Items[0].Remaining, 1e-9)
	assert.Equal(t, "weekly_limit", r.Items[1].Name)
	require.NotNil(t, r.Items[1].Percent)
	assert.InEpsilon(t, 40.0, *r.Items[1].Percent, 1e-9)
}

func TestParseOpenCodeGoWindows(t *testing.T) {
	body := map[string]any{
		"usage": map[string]any{
			"rolling": map[string]any{"status": "ok", "percent": 37.0, "resetsAt": "2026-08-26T14:12:03.000Z"},
			"weekly":  map[string]any{"status": "ok", "percent": 62.0, "resetsAt": "2026-08-31T00:00:00.000Z"},
			"monthly": map[string]any{"status": "rate-limited", "percent": 100.0, "resetsAt": "2026-09-11T00:00:00.000Z"},
		},
	}
	r := parseQuotaUsage("opencode_go", body)
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 3)
	assert.Equal(t, "five_hour", r.Items[0].Name)
	assert.InEpsilon(t, 37.0, *r.Items[0].Percent, 1e-9)
	// percent==0 drops the placeholder resetsAt
	zeroBody := map[string]any{
		"usage": map[string]any{
			"rolling": map[string]any{"status": "ok", "percent": 0.0, "resetsAt": "2026-08-26T15:00:00.000Z"},
		},
	}
	r = parseQuotaUsage("opencode_go", zeroBody)
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 1)
	assert.Nil(t, r.Items[0].Reset)
}

func TestParseZenMuxUsagePercentageIsFraction(t *testing.T) {
	// Documented response: usage_percentage is a 0..1 fraction and must be
	// scaled by 100; USD amounts surface as used/remaining.
	body := map[string]any{
		"success": true,
		"data": map[string]any{
			"plan":           map[string]any{"tier": "ultra", "amount_usd": 200.0, "interval": "month"},
			"account_status": "healthy",
			"quota_5_hour": map[string]any{
				"max_flows": 800.0, "used_flows": 57.2, "remaining_flows": 742.8,
				"usage_percentage": 0.0715,
				"used_value_usd":   14.3, "max_value_usd": 200.0,
				"resets_at": "2026-09-06T15:00:00Z",
			},
			"quota_7_day": map[string]any{
				"max_flows": 6182.0, "used_flows": 416.11, "remaining_flows": 5765.89,
				"usage_percentage": 0.0673,
			},
		},
	}
	r := parseZenMuxUsage(body)
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 2)
	assert.Equal(t, "five_hour", r.Items[0].Name)
	require.NotNil(t, r.Items[0].Percent)
	assert.InEpsilon(t, 7.15, *r.Items[0].Percent, 1e-9)
	require.NotNil(t, r.Items[0].Used)
	assert.InEpsilon(t, 14.3, *r.Items[0].Used, 1e-9)
	require.NotNil(t, r.Items[0].Remaining)
	assert.InEpsilon(t, 185.7, *r.Items[0].Remaining, 1e-9)
	require.NotNil(t, r.Items[0].Reset)
	assert.Equal(t, "weekly_limit", r.Items[1].Name)
	require.NotNil(t, r.Items[1].Percent)
	assert.InEpsilon(t, 6.73, *r.Items[1].Percent, 1e-9)
}

func TestParseZenMuxFailureMarksUpstreamError(t *testing.T) {
	r := parseZenMuxUsage(map[string]any{"success": false, "message": "rate limited"})
	assert.Equal(t, "upstream_error", r.Status)
}

func TestParseVolcengineAFPTiers(t *testing.T) {
	// Official GetAFPUsage example: 5h 25% / weekly 30% / monthly 42.525%;
	// AFPDaily is hidden by the console and skipped; Quota=0 = not subscribed.
	result := map[string]any{
		"PlanType":    "Large",
		"AFPFiveHour": map[string]any{"Quota": 50.0, "Used": 12.5, "ResetTime": 1778806800000.0},
		"AFPDaily":    map[string]any{"Quota": 100.0, "Used": 22.5},
		"AFPWeekly":   map[string]any{"Quota": 500.0, "Used": 150.0, "ResetTime": 1779062400.0},
		"AFPMonthly":  map[string]any{"Quota": 2000.0, "Used": 850.5, "ResetTime": 1780531200.0},
	}
	items := parseAFPTiers(result)
	require.Len(t, items, 3)
	assert.Equal(t, "five_hour", items[0].Name)
	require.NotNil(t, items[0].Percent)
	assert.InEpsilon(t, 25.0, *items[0].Percent, 1e-9)
	assert.Equal(t, "weekly_limit", items[1].Name)
	assert.InEpsilon(t, 30.0, *items[1].Percent, 1e-9)
	assert.Equal(t, "monthly", items[2].Name)
	assert.InEpsilon(t, 42.525, *items[2].Percent, 1e-6)
}

func TestParseVolcengineCodingPlanLevels(t *testing.T) {
	// Real response shape: Level field, seconds ResetTimestamp, session -1
	// means no active window.
	result := map[string]any{
		"QuotaUsage": []any{
			map[string]any{"Level": "session", "Percent": 0.0, "ResetTimestamp": -1.0},
			map[string]any{"Level": "weekly", "Percent": 1.672568, "ResetTimestamp": 1782057600.0},
			map[string]any{"Level": "monthly", "Percent": 0.836284, "ResetTimestamp": 1784303999.0},
		},
	}
	items := parseCodingPlanTiers(result)
	require.Len(t, items, 3)
	assert.Equal(t, "five_hour", items[0].Name)
	assert.Nil(t, items[0].Reset)
	assert.Equal(t, "weekly_limit", items[1].Name)
	require.NotNil(t, items[1].Reset)
	assert.Equal(t, "monthly", items[2].Name)
}

func TestVolcengineRegionDerivation(t *testing.T) {
	assert.Equal(t, "cn-beijing", volcengineRegion("https://ark.cn-beijing.volces.com/api/coding"))
	assert.Equal(t, "cn-shanghai", volcengineRegion("https://ark.cn-shanghai.volces.com/api/coding/v3"))
	assert.Equal(t, "cn-beijing", volcengineRegion("https://example.com/api/coding"))
}

func TestVolcengineSignStructureAndDeterminism(t *testing.T) {
	// Lock the signing contract: no AWS4 prefix, scope ends ark/request,
	// fixed SignedHeaders order, empty-body hash, deterministic output.
	now := time.Date(2024, 6, 21, 0, 0, 0, 0, time.UTC)
	query := volcCanonicalQuery("GetAFPUsage", "cn-beijing")
	assert.Equal(t, "Action=GetAFPUsage&Region=cn-beijing&Version=2024-01-01", query)
	auth, xDate, xContent := volcengineSign("AKLTtest", "secretkey", "cn-beijing", query, []byte{}, now)
	assert.Equal(t, "20240621T000000Z", xDate)
	assert.Equal(t, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", xContent)
	assert.True(t, strings.HasPrefix(auth, "HMAC-SHA256 Credential=AKLTtest/20240621/cn-beijing/ark/request,"), auth)
	assert.True(t, strings.Contains(auth, "SignedHeaders=host;x-date;x-content-sha256;content-type,"), auth)
	sig := auth[strings.LastIndex(auth, "Signature=")+len("Signature="):]
	assert.Len(t, sig, 64)
	auth2, _, _ := volcengineSign("AKLTtest", "secretkey", "cn-beijing", query, []byte{}, now)
	assert.Equal(t, auth, auth2)
}

func TestVolcengineAuthErrorCodeDetection(t *testing.T) {
	assert.True(t, volcIsAuthErrorCode("AccessDenied"))
	assert.True(t, volcIsAuthErrorCode("SignatureDoesNotMatch"))
	assert.True(t, volcIsAuthErrorCode("InvalidAuthorization"))
	assert.False(t, volcIsAuthErrorCode("InvalidParameter.Action"))
	assert.False(t, volcIsAuthErrorCode("InternalError"))
	code, msg, ok := volcResponseError(map[string]any{
		"ResponseMetadata": map[string]any{"Error": map[string]any{"Code": "AccessDenied", "Message": "no permission"}},
	})
	assert.True(t, ok)
	assert.Equal(t, "AccessDenied", code)
	assert.Equal(t, "no permission", msg)
	_, _, ok = volcResponseError(map[string]any{"ResponseMetadata": map[string]any{"RequestId": "x"}})
	assert.False(t, ok)
}

func TestParseVolcengineCredentialShape(t *testing.T) {
	cred, err := parseVolcengineCredential(`{"access_key_id":"AKLT123","secret_access_key":"sk-abc"}`)
	require.NoError(t, err)
	assert.Equal(t, "AKLT123", cred.AccessKeyID)
	assert.Equal(t, "sk-abc", cred.SecretAccessKey)
	_, err = parseVolcengineCredential("plain-bearer-key")
	assert.Error(t, err)
	_, err = parseVolcengineCredential(`{"access_key_id":"","secret_access_key":"x"}`)
	assert.Error(t, err)
	_, err = parseVolcengineCredential("")
	assert.Error(t, err)
}

// ---------------------------------------------------------------------------
// HTTP behavior: auth/network/parse classification via local servers
// ---------------------------------------------------------------------------

func quotaTestServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv
}

func TestQueryZenMuxUsageEndToEnd(t *testing.T) {
	// Full HTTP path: Bearer management key + documented response shape with
	// 0..1 usage_percentage. The override targets the local test server; the
	// host allowlist accepts loopback only in tests.
	srv := quotaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer mgmt-key", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"success": true,
			"data": {
				"plan": {"tier": "pro", "amount_usd": 20, "interval": "month"},
				"account_status": "healthy",
				"quota_5_hour": {"max_flows": 800, "used_flows": 57.2, "remaining_flows": 742.8, "usage_percentage": 0.0715, "resets_at": "2026-09-06T15:00:00Z"},
				"quota_7_day": {"max_flows": 6182, "used_flows": 416.11, "remaining_flows": 5765.89, "usage_percentage": 0.0673}
			}
		}`))
	})
	restore := zenmuxUsageEndpointOverride
	zenmuxUsageEndpointOverride = srv.URL
	defer func() { zenmuxUsageEndpointOverride = restore }()

	client := &http.Client{}
	r := queryZenMuxUsage(context.Background(), client, "mgmt-key")
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 2)
	assert.InEpsilon(t, 7.15, *r.Items[0].Percent, 1e-9)
	assert.InEpsilon(t, 6.73, *r.Items[1].Percent, 1e-9)
}

func TestQueryZenMuxAuthenticationError(t *testing.T) {
	srv := quotaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"success":false}`))
	})
	restore := zenmuxUsageEndpointOverride
	zenmuxUsageEndpointOverride = srv.URL
	defer func() { zenmuxUsageEndpointOverride = restore }()

	r := queryZenMuxUsage(context.Background(), &http.Client{}, "bad-key")
	assert.Equal(t, "authentication_error", r.Status)
}

func TestQueryZenMuxNetworkError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close() // connection refused
	restore := zenmuxUsageEndpointOverride
	zenmuxUsageEndpointOverride = srv.URL
	defer func() { zenmuxUsageEndpointOverride = restore }()

	r := queryZenMuxUsage(context.Background(), &http.Client{}, "k")
	assert.Equal(t, "network_error", r.Status)
}

func TestQueryZenMuxContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r := queryZenMuxUsage(ctx, &http.Client{}, "k")
	assert.NotEqual(t, "ok", r.Status)
}

func TestQueryVolcengineUsageEndToEnd(t *testing.T) {
	// GetAFPUsage returns an empty (unsubscribed) result, the probe falls
	// through to GetCodingPlanUsage which returns the real tiers. Auth uses
	// the Volcengine SigV4 Authorization header, not Bearer.
	var calls []string
	srv := quotaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		action := r.FormValue("Action")
		calls = append(calls, action)
		assert.NotEmpty(t, r.Header.Get("Authorization"))
		assert.True(t, strings.HasPrefix(r.Header.Get("Authorization"), "HMAC-SHA256 "), "expected volcengine signature")
		w.Header().Set("Content-Type", "application/json")
		if action == "GetAFPUsage" {
			_, _ = w.Write([]byte(`{"Result":{"PlanType":"","AFPFiveHour":{"Quota":0,"Used":0},"AFPWeekly":{"Quota":0,"Used":0},"AFPMonthly":{"Quota":0,"Used":0}}}`))
			return
		}
		_, _ = w.Write([]byte(`{"Result":{"Status":"Running","QuotaUsage":[{"Level":"session","Percent":12.5,"ResetTimestamp":1782057600},{"Level":"weekly","Percent":3.4,"ResetTimestamp":1782057600}]}}`))
	})
	restore := volcUsageEndpointOverride
	volcUsageEndpointOverride = srv.URL
	defer func() { volcUsageEndpointOverride = restore }()

	cred := volcengineCredential{AccessKeyID: "AKLT123", SecretAccessKey: "sk-abc"}
	r := queryVolcengineUsage(context.Background(), &http.Client{}, "https://ark.cn-beijing.volces.com/api/coding", cred)
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 2)
	assert.Equal(t, "five_hour", r.Items[0].Name)
	assert.InEpsilon(t, 12.5, *r.Items[0].Percent, 1e-9)
	assert.Equal(t, []string{"GetAFPUsage", "GetCodingPlanUsage"}, calls)
}

func TestQueryVolcengineAuthErrorStopsProbe(t *testing.T) {
	var calls []string
	srv := quotaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		calls = append(calls, r.FormValue("Action"))
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{}`))
	})
	restore := volcUsageEndpointOverride
	volcUsageEndpointOverride = srv.URL
	defer func() { volcUsageEndpointOverride = restore }()

	cred := volcengineCredential{AccessKeyID: "AK", SecretAccessKey: "SK"}
	r := queryVolcengineUsage(context.Background(), &http.Client{}, "https://ark.cn-beijing.volces.com/api/coding", cred)
	assert.Equal(t, "authentication_error", r.Status)
	assert.Equal(t, []string{"GetAFPUsage"}, calls, "shared AK/SK means auth failure must stop the second probe")
}

func TestQueryVolcengineGatewayEnvelopeAuthError(t *testing.T) {
	// The gateway often answers signature errors with HTTP 400 + envelope.
	srv := quotaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"ResponseMetadata":{"RequestId":"x","Error":{"Code":"InvalidAuthorization","Message":"bad signature"}}}`))
	})
	restore := volcUsageEndpointOverride
	volcUsageEndpointOverride = srv.URL
	defer func() { volcUsageEndpointOverride = restore }()

	cred := volcengineCredential{AccessKeyID: "AK", SecretAccessKey: "SK"}
	r := queryVolcengineUsage(context.Background(), &http.Client{}, "", cred)
	assert.Equal(t, "authentication_error", r.Status)
}

func TestFetchQuotaUsageInvalidJSONAndRateLimit(t *testing.T) {
	srv := quotaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte("slow down"))
	})
	// Point the kimi preset at the local server to classify the response.
	restore := quotaUsageEndpoints["kimi_coding_plan"]
	quotaUsageEndpoints["kimi_coding_plan"] = srv.URL
	defer func() { quotaUsageEndpoints["kimi_coding_plan"] = restore }()

	cfg := QuotaQueryConfig{ResolvedPresetID: "kimi_coding_plan"}
	r := fetchQuotaUsage(context.Background(), &http.Client{}, cfg, QuotaQueryCredential{Key: "k"})
	assert.Equal(t, "rate_limited", r.Status)

	srv2 := quotaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("not-json"))
	})
	quotaUsageEndpoints["kimi_coding_plan"] = srv2.URL
	r = fetchQuotaUsage(context.Background(), &http.Client{}, cfg, QuotaQueryCredential{Key: "k"})
	assert.Equal(t, "invalid_response", r.Status)
}

func TestFetchQuotaUsageZhipuAuthHeaderHasNoBearer(t *testing.T) {
	srv := quotaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "raw-zhipu-key", r.Header.Get("Authorization"), "Zhipu quota endpoint does not accept the Bearer prefix")
		assert.Equal(t, "org-1", r.Header.Get("bigmodel-organization"))
		assert.Equal(t, "proj-1", r.Header.Get("bigmodel-project"))
		_, _ = w.Write([]byte(`{"success":true,"data":{"limits":[{"type":"TOKENS_LIMIT","unit":3,"percentage":5.0}]}}`))
	})
	restore := quotaUsageEndpoints["glm_coding_plan_team"]
	quotaUsageEndpoints["glm_coding_plan_team"] = srv.URL
	defer func() { quotaUsageEndpoints["glm_coding_plan_team"] = restore }()

	cfg := QuotaQueryConfig{ResolvedPresetID: "glm_coding_plan_team", Extra: map[string]string{"organization_id": "org-1", "project_id": "proj-1"}}
	r := fetchQuotaUsage(context.Background(), &http.Client{}, cfg, QuotaQueryCredential{Key: "raw-zhipu-key"})
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 1)
	assert.InEpsilon(t, 5.0, *r.Items[0].Percent, 1e-9)
}

func TestReadQuotaBodyClassifications(t *testing.T) {
	cases := []struct {
		name   string
		code   int
		body   string
		expect string
	}{
		{"401", 401, "{}", "authentication_error"},
		{"403", 403, "{}", "authentication_error"},
		{"429", 429, "slow down", "rate_limited"},
		{"500", 500, "oops", "upstream_error"},
		{"ok", 200, `{"ok":true}`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := quotaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.code)
				_, _ = w.Write([]byte(tc.body))
			})
			resp, err := http.Get(srv.URL)
			require.NoError(t, err)
			body, status := readQuotaBody(resp)
			assert.Equal(t, tc.expect, status)
			if status == "" {
				var m map[string]any
				require.NoError(t, common.Unmarshal(body, &m))
			}
		})
	}
}

func TestFetchQuotaUsageNetworkErrorAndContextCancellation(t *testing.T) {
	// Closed listener -> immediate connection refused.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close()
	client := &http.Client{}
	cfg := QuotaQueryConfig{ResolvedPresetID: "unsupported"}
	r := fetchQuotaUsage(context.Background(), client, cfg, QuotaQueryCredential{Key: "k"})
	assert.Equal(t, "unsupported", r.Status)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cfg2 := QuotaQueryConfig{ResolvedPresetID: "kimi_coding_plan"}
	// Fixed endpoint unreachable in offline env -> network error rather than
	// hanging; with a cancelled ctx the request fails fast.
	r2 := fetchQuotaUsage(ctx, client, cfg2, QuotaQueryCredential{Key: "k"})
	assert.NotEqual(t, "ok", r2.Status)
}

// ---------------------------------------------------------------------------
// Binding validation and per-request key_index
// ---------------------------------------------------------------------------

func TestValidateQuotaQueryBindingRejections(t *testing.T) {
	cases := []struct {
		name     string
		settings string
		key      string
		expect   string
	}{
		{"bad preset", `{"quota_query_preset_id":"nope"}`, "sk", "unsupported quota query preset"},
		{"bad mode", `{"quota_query_credential_mode":"weird"}`, "sk", "unsupported quota query credential mode"},
		{"key index oob", `{"quota_query_key_index":5}`, "sk", "quota query key index out of bounds"},
		{"unknown field", `{"quota_query_evil":"x"}`, "sk", "unsupported quota query field"},
		{"bad extra", `{"quota_query_preset_id":"glm_coding_plan_team","quota_query_extra":{"hacker":"1"}}`, "sk", "unsupported quota query extra field"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ch := &model.Channel{Key: tc.key, OtherSettings: tc.settings}
			err := ValidateQuotaQueryBinding(ch)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.expect)
		})
	}
}

func TestQueryChannelQuotaMultiKeyIndexOutOfBounds(t *testing.T) {
	ch := &model.Channel{
		Key:           "k1\nk2",
		ChannelInfo:   model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2},
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan","quota_query_key_index":0}`,
	}
	idx := 9
	r := QueryChannelQuotaWithOption(context.Background(), ch, true, QuotaQueryOption{KeyIndex: &idx})
	assert.Equal(t, "needs_configuration", r.Status)
	// Negative per-request index is rejected outright.
	neg := -1
	r = QueryChannelQuotaWithOption(context.Background(), ch, true, QuotaQueryOption{KeyIndex: &neg})
	assert.Equal(t, "needs_configuration", r.Status)
}

// ---------------------------------------------------------------------------
// json round-trip of the settings field
// ---------------------------------------------------------------------------

func TestQuotaQueryCredentialChannelIDRoundTrip(t *testing.T) {
	raw := `{"quota_query_preset_id":"volcengine_coding_plan","quota_query_credential_channel_id":42,"quota_query_extra":{"region":"cn-beijing"}}`
	s, err := ParseQuotaQuerySettings(raw)
	require.NoError(t, err)
	require.NotNil(t, s.QuotaQueryCredentialChannelID)
	assert.Equal(t, 42, *s.QuotaQueryCredentialChannelID)
	assert.Equal(t, "volcengine_coding_plan", s.QuotaQueryPresetID)
	out, err := json.Marshal(s)
	require.NoError(t, err)
	assert.True(t, strings.Contains(string(out), `"quota_query_credential_channel_id":42`))
	// Empty omits the field entirely.
	s2, err := ParseQuotaQuerySettings(`{}`)
	require.NoError(t, err)
	assert.Nil(t, s2.QuotaQueryCredentialChannelID)
}

// ---------------------------------------------------------------------------
// Credential channel reference validation (DB-backed via package TestMain)
// ---------------------------------------------------------------------------

func TestDetectQuotaQueryPresetZenMuxAndOpenCode(t *testing.T) {
	assert.Equal(t, "zenmux", DetectQuotaQueryPreset("https://zenmux.ai/api/v1"))
	assert.Equal(t, "zenmux", DetectQuotaQueryPreset("https://zenmux.ai/api/anthropic"))
	assert.Equal(t, "zenmux", DetectQuotaQueryPreset("https://zenmux.ai/api/vertex-ai"))
	assert.Equal(t, "", DetectQuotaQueryPreset("https://zenmux.ai/api/v1/management/subscription/detail"))
	assert.Equal(t, "opencode_go", DetectQuotaQueryPreset("https://opencode.ai/zen/go"))
	assert.Equal(t, "opencode_go", DetectQuotaQueryPreset("https://opencode.ai/zen/go/v1"))
	assert.Equal(t, "", DetectQuotaQueryPreset("https://opencode.ai/zen/v1"))
}

func TestValidateQuotaQueryBindingCredentialChannelReference(t *testing.T) {
	cred := &model.Channel{Type: 1, Name: "volc-aksk-holder", Key: `{"access_key_id":"AK","secret_access_key":"SK"}`, Status: 1}
	require.NoError(t, model.DB.Create(cred).Error)

	// Valid reference resolves and validates.
	user := &model.Channel{
		Key:           "sk-inference",
		OtherSettings: `{"quota_query_preset_id":"volcengine_coding_plan","quota_query_extra":{"region":"cn-beijing"},"quota_query_credential_channel_id":` + itoaChannelID(cred.Id) + `}`,
	}
	assert.NoError(t, ValidateQuotaQueryBinding(user))

	// Self reference is rejected.
	user.OtherSettings = `{"quota_query_preset_id":"kimi_coding_plan","quota_query_credential_channel_id":` + itoaChannelID(cred.Id) + `}`
	require.NoError(t, model.DB.Create(user).Error)
	self := &model.Channel{Id: user.Id, Key: "k", OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan","quota_query_credential_channel_id":` + itoaChannelID(user.Id) + `}`}
	assert.Error(t, ValidateQuotaQueryBinding(self))

	// Missing reference is rejected.
	missing := &model.Channel{Key: "k", OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan","quota_query_credential_channel_id":999999}`}
	assert.ErrorContains(t, ValidateQuotaQueryBinding(missing), "not found")

	// Non-positive reference is rejected.
	zero := &model.Channel{Key: "k", OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan","quota_query_credential_channel_id":0}`}
	assert.Error(t, ValidateQuotaQueryBinding(zero))
}

func TestGetQuotaQueryConfigSeparateRequiresCredentialChannel(t *testing.T) {
	ch := &model.Channel{
		Key:           "sk-inference",
		OtherSettings: `{"quota_query_preset_id":"volcengine_coding_plan","quota_query_extra":{"region":"cn-beijing"}}`,
	}
	cfg, err := GetQuotaQueryConfig(ch)
	require.NoError(t, err)
	assert.False(t, cfg.CanQuery)
	assert.Equal(t, "needs_configuration", cfg.Status)
	assert.Contains(t, cfg.MissingFields, "credential_channel_id")
}

func itoaChannelID(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

func TestQuotaUsageCacheHitFlag(t *testing.T) {
	srv := quotaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"limits":[{"detail":{"limit":100,"remaining":90}}],"usage":{"limit":100,"remaining":90}}`))
	})
	restore := quotaUsageEndpoints["kimi_coding_plan"]
	quotaUsageEndpoints["kimi_coding_plan"] = srv.URL
	defer func() { quotaUsageEndpoints["kimi_coding_plan"] = restore }()
	channelQuotaCache.mu.Lock()
	channelQuotaCache.entries = make(map[string]quotaCacheEntry)
	channelQuotaCache.mu.Unlock()

	ch := &model.Channel{
		Id:            424242,
		Key:           "cache-hit-key",
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan","quota_query_key_index":0}`,
	}
	first := QueryChannelQuota(context.Background(), ch, true)
	require.Equal(t, "ok", first.Status)
	assert.False(t, first.CacheHit, "forced refresh must not be a cache hit")
	second := QueryChannelQuota(context.Background(), ch, false)
	require.Equal(t, "ok", second.Status)
	assert.True(t, second.CacheHit, "second read within TTL must be served from cache")
	third := QueryChannelQuota(context.Background(), ch, true)
	assert.False(t, third.CacheHit, "refresh bypasses the cache")
}

func TestQuotaUsageItemUnitFields(t *testing.T) {
	// Kimi amounts are provider plan quota units.
	body := map[string]any{
		"limits": []any{map[string]any{"detail": map[string]any{"limit": 100.0, "remaining": 70.0}}},
		"usage":  map[string]any{"limit": 200.0, "remaining": 120.0},
	}
	r := parseQuotaUsage("kimi_coding_plan", body)
	require.Len(t, r.Items, 2)
	assert.Equal(t, "quota", r.Items[0].Unit)
	assert.Equal(t, "quota", r.Items[1].Unit)

	// ZenMux amounts are USD.
	z := map[string]any{
		"success": true,
		"data": map[string]any{
			"quota_5_hour": map[string]any{"usage_percentage": 0.5, "used_value_usd": 1.0, "max_value_usd": 2.0},
		},
	}
	r = parseZenMuxUsage(z)
	require.Len(t, r.Items, 1)
	assert.Equal(t, "usd", r.Items[0].Unit)
}
