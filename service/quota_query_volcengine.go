package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

var errVolcCredential = errors.New("credential channel key must be JSON with access_key_id and secret_access_key")

// Volcengine Agent Plan / Coding Plan usage queries are control-plane OpenAPI
// calls: gateway https://open.volcengineapi.com (NOT the inference host
// ark.cn-beijing.volces.com), POST with mandatory Volcengine Signature V4
// (AK/SK). Reusing the inference Bearer key is rejected by the gateway with
// InvalidAuthorization. Contracts follow cc-switch db41d701
// (query_volcengine and its signing helpers).
const (
	volcengineOpenAPIHost   = "open.volcengineapi.com"
	volcengineAPIVersion    = "2024-01-01"
	volcengineDefaultRegion = "cn-beijing"
	volcengineService       = "ark"
	volcengineContentType   = "application/json; charset=utf-8"
	volcengineSignedHeaders = "host;x-date;x-content-sha256;content-type"
	volcengineAKSKHint      = "Check the AccessKey ID / Secret are correct and the account has Ark usage-query (OpenAPI) permission."
)

// volcengineCredential is the AK/SK pair parsed from the referenced
// credential channel key (JSON {"access_key_id":...,"secret_access_key":...}).
type volcengineCredential struct {
	AccessKeyID     string `json:"access_key_id"`
	SecretAccessKey string `json:"secret_access_key"`
}

func parseVolcengineCredential(raw string) (*volcengineCredential, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || strings.ContainsAny(trimmed, "\r\n") {
		return nil, errVolcCredential
	}
	var c volcengineCredential
	if err := common.Unmarshal([]byte(trimmed), &c); err != nil {
		return nil, errVolcCredential
	}
	if strings.TrimSpace(c.AccessKeyID) == "" || strings.TrimSpace(c.SecretAccessKey) == "" {
		return nil, errVolcCredential
	}
	return &c, nil
}

// volcengineRegion derives the control-plane region from the data-plane
// base_url (ark.cn-beijing.volces.com -> cn-beijing), falling back to
// cn-beijing.
func volcengineRegion(baseURL string) string {
	host := baseURL
	if i := strings.Index(host, "://"); i >= 0 {
		host = host[i+3:]
	}
	if i := strings.Index(host, "/"); i >= 0 {
		host = host[:i]
	}
	for _, p := range strings.Split(host, ".") {
		if strings.HasPrefix(p, "cn-") || strings.HasPrefix(p, "ap-") {
			return p
		}
	}
	return volcengineDefaultRegion
}

func volcIsAuthErrorCode(code string) bool {
	c := strings.ToLower(code)
	return strings.Contains(c, "auth") || strings.Contains(c, "signature") ||
		strings.Contains(c, "accessdenied") || strings.Contains(c, "denied") ||
		strings.Contains(c, "unauthorized") || strings.Contains(c, "forbidden") ||
		strings.Contains(c, "credential") || strings.Contains(c, "token")
}

// volcCanonicalQuery is sorted by key (Action < Region < Version) and
// RFC3986-encoded; the same string signs and forms the request URL.
func volcCanonicalQuery(action, region string) string {
	pairs := [][2]string{{"Action", action}, {"Region", region}, {"Version", volcengineAPIVersion}}
	sort.Slice(pairs, func(i, j int) bool { return pairs[i][0] < pairs[j][0] })
	parts := make([]string, 0, len(pairs))
	for _, p := range pairs {
		parts = append(parts, volcURIEncode(p[0])+"="+volcURIEncode(p[1]))
	}
	return strings.Join(parts, "&")
}

func volcURIEncode(s string) string {
	const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if strings.IndexByte(unreserved, c) >= 0 {
			b.WriteByte(c)
		} else {
			const hexDigits = "0123456789ABCDEF"
			b.WriteString("%")
			b.WriteByte(hexDigits[c>>4])
			b.WriteByte(hexDigits[c&0xF])
		}
	}
	return b.String()
}

func volcHMAC(key, data []byte) []byte {
	m := hmac.New(sha256.New, key)
	m.Write(data)
	return m.Sum(nil)
}

func volcSHA256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// volcengineSign implements the Volcengine SigV4 variant. Two differences
// from AWS SigV4 matter: canonical headers use the fixed order
// host;x-date;x-content-sha256;content-type (not alphabetical), and the
// algorithm string is HMAC-SHA256 with scope ending in /request and key
// derivation without the AWS4 prefix.
func volcengineSign(accessKeyID, secretAccessKey, region, canonicalQuery string, body []byte, now time.Time) (authorization, xDate, xContentSha256 string) {
	xDate = now.UTC().Format("20060102T150405Z")
	shortDate := now.UTC().Format("20060102")
	xContentSha256 = volcSHA256Hex(body)

	canonicalHeaders := "host:" + volcengineOpenAPIHost + "\nx-date:" + xDate +
		"\nx-content-sha256:" + xContentSha256 + "\ncontent-type:" + volcengineContentType + "\n"
	canonicalRequest := strings.Join([]string{"POST", "/", canonicalQuery, canonicalHeaders, volcengineSignedHeaders, xContentSha256}, "\n")
	credentialScope := shortDate + "/" + region + "/" + volcengineService + "/request"
	stringToSign := "HMAC-SHA256\n" + xDate + "\n" + credentialScope + "\n" + volcSHA256Hex([]byte(canonicalRequest))

	kDate := volcHMAC([]byte(secretAccessKey), []byte(shortDate))
	kRegion := volcHMAC(kDate, []byte(region))
	kService := volcHMAC(kRegion, []byte(volcengineService))
	kSigning := volcHMAC(kService, []byte("request"))
	signature := hex.EncodeToString(volcHMAC(kSigning, []byte(stringToSign)))

	authorization = "HMAC-SHA256 Credential=" + accessKeyID + "/" + credentialScope +
		", SignedHeaders=" + volcengineSignedHeaders + ", Signature=" + signature
	return authorization, xDate, xContentSha256
}

type volcCallResult struct {
	body      map[string]any
	authError bool // hard credential failure; both plans share AK/SK, stop
	soft      bool // non-auth HTTP/parse failure; the other plan may still work
	transient bool // network/timeout; abort immediately
	message   string
}

// volcengineOpenAPICall performs one signed POST against the gateway.
func volcengineOpenAPICall(ctx context.Context, client *http.Client, region string, cred volcengineCredential, action string) volcCallResult {
	canonicalQuery := volcCanonicalQuery(action, region)
	// Signing always uses the production host string so the signing contract
	// stays pinned; only the TCP target is overridable (tests).
	endpoint := "https://" + volcengineOpenAPIHost + "/"
	if volcUsageEndpointOverride != "" {
		endpoint = volcUsageEndpointOverride
	}
	url := endpoint + "?" + canonicalQuery
	var body []byte
	authorization, xDate, xContentSha256 := volcengineSign(cred.AccessKeyID, cred.SecretAccessKey, region, canonicalQuery, body, time.Now())

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return volcCallResult{soft: true, message: "request build failed"}
	}
	req.Header.Set("X-Date", xDate)
	req.Header.Set("X-Content-Sha256", xContentSha256)
	req.Header.Set("Content-Type", volcengineContentType)
	req.Header.Set("Authorization", authorization)
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return volcCallResult{transient: true, message: "timeout"}
		}
		return volcCallResult{transient: true, message: "network_error"}
	}
	// The gateway often returns 4xx (usually 400) with the same
	// ResponseMetadata.Error envelope as the 200 path for signature or
	// credential failures, so the body is read before status classification.
	const maxBody = 1 << 20
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	closeErr := resp.Body.Close()
	if readErr != nil {
		return volcCallResult{transient: true, message: "network_error"}
	}
	if closeErr != nil {
		return volcCallResult{transient: true, message: "network_error"}
	}
	var data map[string]any
	parseOK := common.Unmarshal(raw, &data) == nil
	if parseOK {
		if code, msg, ok := volcResponseError(data); ok {
			if volcIsAuthErrorCode(code) {
				return volcCallResult{authError: true, message: "authentication_error (" + code + "): " + msg + ". " + volcengineAKSKHint}
			}
			return volcCallResult{soft: true, message: "upstream_error (" + code + "): " + msg}
		}
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return volcCallResult{authError: true, message: "authentication_error: HTTP " + strconv.Itoa(resp.StatusCode) + ". " + volcengineAKSKHint}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return volcCallResult{soft: true, message: "upstream_error: HTTP " + strconv.Itoa(resp.StatusCode)}
	}
	if !parseOK {
		return volcCallResult{soft: true, message: "invalid_response"}
	}
	return volcCallResult{body: data}
}

// volcResponseError extracts ResponseMetadata.Error (or top-level Error).
func volcResponseError(body map[string]any) (code, message string, ok bool) {
	meta, _ := body["ResponseMetadata"].(map[string]any)
	if meta == nil {
		meta, _ = body["Error"].(map[string]any)
		if meta == nil {
			return "", "", false
		}
	}
	errObj, _ := meta["Error"].(map[string]any)
	if errObj == nil {
		return "", "", false
	}
	code, _ = errObj["Code"].(string)
	message, _ = errObj["Message"].(string)
	if code == "" && message == "" {
		return "", "", false
	}
	return code, message, true
}

// parseAFPTiers converts GetAFPUsage Result windows into usage items.
// Quota/Used are absolute AFP values; Quota<=0 means the window is not
// subscribed and is skipped (an authenticated-but-no-Agent-Plan result then
// falls through to the Coding Plan probe). AFPDaily is hidden by the official
// console and skipped as well. Percentages pass through unclamped.
func parseAFPTiers(result map[string]any) []QuotaUsageItem {
	windows := []struct{ key, name string }{
		{"AFPFiveHour", "five_hour"},
		{"AFPWeekly", "weekly_limit"},
		{"AFPMonthly", "monthly"},
	}
	items := make([]QuotaUsageItem, 0, 3)
	for _, w := range windows {
		win := quotaObject(result[w.key])
		if win == nil {
			continue
		}
		q := quotaNumber(win["Quota"])
		if q == nil || *q <= 0 {
			continue
		}
		used := quotaNumber(win["Used"])
		var p *float64
		if used != nil {
			pct := *used / *q * 100
			p = &pct
		}
		items = append(items, QuotaUsageItem{Name: w.name, Percent: p, Reset: quotaReset(win["ResetTime"], false)})
	}
	return items
}

// volcCodingWindow normalizes GetCodingPlanUsage window labels to tier names.
func volcCodingWindow(label string) string {
	switch strings.ToLower(label) {
	case "session", "5h", "fivehour", "five_hour", "rolling_5h":
		return "five_hour"
	case "weekly", "week", "7d":
		return "weekly_limit"
	case "monthly", "month":
		return "monthly"
	}
	return ""
}

// parseCodingPlanTiers defensively parses GetCodingPlanUsage Result. The real
// field is `Level` (verified 2026-06-21: session/weekly/monthly); the other
// label keys are fallbacks. Only percentages are returned; ResetTime is
// seconds or milliseconds (session with no active window reports -1 -> no
// reset).
func parseCodingPlanTiers(result map[string]any) []QuotaUsageItem {
	arr := quotaArray(result["QuotaUsage"])
	if arr == nil {
		arr = quotaArray(result["Usages"])
	}
	if arr == nil {
		arr = quotaArray(result["Details"])
	}
	items := make([]QuotaUsageItem, 0, 3)
	for _, raw := range arr {
		item := quotaObject(raw)
		if item == nil {
			continue
		}
		label := ""
		for _, key := range []string{"Level", "Type", "Period", "Label", "Window"} {
			if s, ok := item[key].(string); ok && s != "" {
				label = s
				break
			}
		}
		name := volcCodingWindow(label)
		if name == "" {
			continue
		}
		var p *float64
		for _, key := range []string{"Percent", "UsedPercent", "UsagePercent"} {
			if n := quotaNumber(item[key]); n != nil {
				p = n
				break
			}
		}
		var reset *string
		resetVal, hasReset := item["ResetTime"]
		if !hasReset {
			resetVal, hasReset = item["ResetTimestamp"]
		}
		if hasReset {
			reset = quotaReset(resetVal, false)
		}
		items = append(items, QuotaUsageItem{Name: name, Percent: p, Reset: reset})
	}
	return items
}

// queryVolcengineUsage probes Agent Plan (GetAFPUsage) first, then Coding
// Plan (GetCodingPlanUsage). Auth failures stop immediately (both plans share
// the same AK/SK); soft failures accumulate; transient failures abort.
func queryVolcengineUsage(ctx context.Context, client *http.Client, baseURL string, cred volcengineCredential) QuotaUsage {
	region := volcengineRegion(baseURL)
	softErrors := make([]string, 0, 2)

	res := volcengineOpenAPICall(ctx, client, region, cred, "GetAFPUsage")
	if res.transient {
		return quotaResult("timeout")
	}
	if res.authError {
		return quotaErrorResult("authentication_error", res.message)
	}
	if res.soft {
		softErrors = append(softErrors, "GetAFPUsage: "+res.message)
	} else {
		result := quotaObject(res.body["Result"])
		if result == nil {
			result = res.body
		}
		items := parseAFPTiers(result)
		if len(items) > 0 {
			return quotaUsageFromItems(items)
		}
	}

	res = volcengineOpenAPICall(ctx, client, region, cred, "GetCodingPlanUsage")
	if res.transient {
		return quotaResult("timeout")
	}
	if res.authError {
		return quotaErrorResult("authentication_error", res.message)
	}
	if res.soft {
		softErrors = append(softErrors, "GetCodingPlanUsage: "+res.message)
	} else {
		result := quotaObject(res.body["Result"])
		if result == nil {
			result = res.body
		}
		items := parseCodingPlanTiers(result)
		if len(items) > 0 {
			return quotaUsageFromItems(items)
		}
	}

	if len(softErrors) > 0 {
		return quotaErrorResult("upstream_error", strings.Join(softErrors, "; "))
	}
	return quotaErrorResult("invalid_response", "no active Agent Plan or Coding Plan subscription found for this credential")
}

func quotaUsageFromItems(items []QuotaUsageItem) QuotaUsage {
	r := quotaResult("ok")
	r.Items = items
	return r
}
