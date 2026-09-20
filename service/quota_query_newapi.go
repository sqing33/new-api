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
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// newApiSubscriptionCredential parses the new_api_subscription query
// credential from quota_query_extra: the upstream user PAT plus the user id
// sent as the New-Api-User header. The forwarding sk- key cannot read the
// dashboard subscription API, which is why these live in extra fields.
type newApiSubscriptionCredential struct {
	AccessToken string
	UserID      int
}

func parseNewApiSubscriptionCredential(extra map[string]string) (newApiSubscriptionCredential, bool) {
	token := strings.TrimSpace(extra["access_token"])
	idRaw := strings.TrimSpace(extra["user_id"])
	if token == "" || idRaw == "" {
		return newApiSubscriptionCredential{}, false
	}
	userID, err := strconv.Atoi(idRaw)
	if err != nil || userID <= 0 || strings.ContainsAny(token, "\r\n") {
		return newApiSubscriptionCredential{}, false
	}
	return newApiSubscriptionCredential{AccessToken: token, UserID: userID}, true
}

// newApiSubscriptionItem mirrors the upstream UserSubscription fields this
// preset reports. Amounts are new-api quota units.
type newApiSubscriptionItem struct {
	AmountTotal int64  `json:"amount_total"`
	AmountUsed  int64  `json:"amount_used"`
	NextResetAt int64  `json:"next_reset_time"`
	PlanID      int    `json:"plan_id"`
	Status      string `json:"status"`
}

type newApiSubscriptionBody struct {
	Success bool `json:"success"`
	Data    struct {
		Subscriptions []struct {
			Subscription newApiSubscriptionItem `json:"subscription"`
		} `json:"subscriptions"`
	} `json:"data"`
}

// queryNewApiSubscriptionUsage queries the upstream new-api instance's own
// dashboard subscription endpoint (GET {base}/api/subscription/self) with the
// PAT + New-Api-User header pair. Each ACTIVE subscription becomes one
// window item: percent = used/total, remaining = total-used, reset from
// next_reset_time. Expired subscriptions are skipped; data is never invented.
func queryNewApiSubscriptionUsage(ctx context.Context, client *http.Client, baseURL string, extra map[string]string) QuotaUsage {
	cred, ok := parseNewApiSubscriptionCredential(extra)
	if !ok {
		return quotaErrorResult("needs_configuration", "new_api_subscription needs an access_token and a numeric user_id")
	}
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" || !strings.HasPrefix(base, "http://") && !strings.HasPrefix(base, "https://") {
		return quotaErrorResult("needs_configuration", "channel base_url is required for new_api_subscription")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/subscription/self", nil)
	if err != nil {
		return quotaResult("needs_configuration")
	}
	req.Header.Set("Authorization", "Bearer "+cred.AccessToken)
	req.Header.Set("New-Api-User", strconv.Itoa(cred.UserID))
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
	var parsed newApiSubscriptionBody
	if common.Unmarshal(body, &parsed) != nil {
		return quotaResult("invalid_response")
	}
	if !parsed.Success {
		return quotaErrorResult("upstream_error", "upstream subscription API returned success=false")
	}
	r := quotaResult("ok")
	active := 0
	for _, sub := range parsed.Data.Subscriptions {
		s := sub.Subscription
		if s.Status != "active" {
			continue
		}
		active++
		name := "subscription"
		if len(parsed.Data.Subscriptions) > 1 {
			// Multiple active subscriptions: stable per-plan names so the
			// frontend renders one row per plan instead of colliding.
			name = "subscription_p" + strconv.Itoa(s.PlanID)
		}
		item := QuotaUsageItem{Name: name, Unit: "quota"}
		used := float64(s.AmountUsed)
		total := float64(s.AmountTotal)
		if s.AmountUsed >= 0 {
			item.Used = &used
		}
		if s.AmountTotal > 0 {
			remaining := math.Max(0, total-used)
			item.Remaining = &remaining
			percent := math.Round(used/total*10000) / 100
			item.Percent = &percent
		}
		if s.NextResetAt > 0 {
			reset := time.Unix(s.NextResetAt, 0).UTC().Format(time.RFC3339)
			item.Reset = &reset
		}
		r.Items = append(r.Items, item)
	}
	if active == 0 {
		return quotaErrorResult("needs_configuration", "no active subscription on the upstream account")
	}
	return r
}
