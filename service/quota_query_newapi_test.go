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
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewApiSubscriptionPresetRegistered(t *testing.T) {
	found := false
	for _, p := range GetQuotaQueryPresets() {
		if p.ID == "new_api_subscription" {
			found = true
			require.Equal(t, "separate", p.CredentialMode)
			require.True(t, p.QueryImplemented)
			require.ElementsMatch(t, []string{"access_token", "user_id"}, p.RequiredExtraFields)
		}
	}
	assert.True(t, found, "new_api_subscription preset must be registered")
}

func TestParseNewApiSubscriptionCredential(t *testing.T) {
	ok, valid := parseNewApiSubscriptionCredential(map[string]string{"access_token": "tok", "user_id": "13"})
	require.True(t, valid)
	assert.Equal(t, "tok", ok.AccessToken)
	assert.Equal(t, 13, ok.UserID)

	_, missingToken := parseNewApiSubscriptionCredential(map[string]string{"user_id": "13"})
	assert.False(t, missingToken)
	_, missingID := parseNewApiSubscriptionCredential(map[string]string{"access_token": "tok"})
	assert.False(t, missingID)
	_, badID := parseNewApiSubscriptionCredential(map[string]string{"access_token": "tok", "user_id": "abc"})
	assert.False(t, badID)
	_, zeroID := parseNewApiSubscriptionCredential(map[string]string{"access_token": "tok", "user_id": "0"})
	assert.False(t, zeroID)
	_, negativeID := parseNewApiSubscriptionCredential(map[string]string{"access_token": "tok", "user_id": "-3"})
	assert.False(t, negativeID)
}

func TestQueryNewApiSubscriptionEndToEnd(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/subscription/self", r.URL.Path)
		assert.Equal(t, "Bearer pat-token", r.Header.Get("Authorization"))
		assert.Equal(t, "13", r.Header.Get("New-Api-User"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"success": true,
			"data": {
				"billing_preference": "subscription_first",
				"subscriptions": [
					{"subscription": {"id": 8, "plan_id": 2, "amount_total": 15000000, "amount_used": 0, "next_reset_time": 1788710400, "status": "active"}},
					{"subscription": {"id": 7, "plan_id": 1, "amount_total": 15000000, "amount_used": 1050152, "next_reset_time": 1788706389, "status": "active"}},
					{"subscription": {"id": 5, "plan_id": 1, "amount_total": 100, "amount_used": 100, "status": "expired"}}
				]
			}
		}`))
	}))
	t.Cleanup(srv.Close)

	r := queryNewApiSubscriptionUsage(t.Context(), srv.Client(), srv.URL, map[string]string{"access_token": "pat-token", "user_id": "13"})
	require.Equal(t, "ok", r.Status)
	// Expired subscription is skipped; two active ones get per-plan names.
	require.Len(t, r.Items, 2)
	first := r.Items[0]
	assert.Equal(t, "subscription_p2", first.Name)
	assert.Equal(t, "quota", first.Unit)
	require.NotNil(t, first.Percent)
	assert.InDelta(t, 0.0, *first.Percent, 1e-9)
	require.NotNil(t, first.Remaining)
	assert.InEpsilon(t, 15000000, *first.Remaining, 1e-9)
	second := r.Items[1]
	assert.Equal(t, "subscription_p1", second.Name)
	require.NotNil(t, second.Used)
	assert.InEpsilon(t, 1050152, *second.Used, 1e-9)
	require.NotNil(t, second.Percent)
	assert.InEpsilon(t, 7.0, *second.Percent, 0.01)
	require.NotNil(t, second.Reset)
	assert.Contains(t, *second.Reset, "2026-")
}

func TestQueryNewApiSubscriptionSingleActiveUsesSimpleName(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success": true, "data": {"subscriptions": [
			{"subscription": {"plan_id": 3, "amount_total": 500, "amount_used": 250, "next_reset_time": 0, "status": "active"}}
		]}}`))
	}))
	t.Cleanup(srv.Close)

	r := queryNewApiSubscriptionUsage(t.Context(), srv.Client(), srv.URL, map[string]string{"access_token": "t", "user_id": "1"})
	require.Equal(t, "ok", r.Status)
	require.Len(t, r.Items, 1)
	assert.Equal(t, "subscription", r.Items[0].Name)
	require.NotNil(t, r.Items[0].Percent)
	assert.InEpsilon(t, 50.0, *r.Items[0].Percent, 1e-9)
	// next_reset_time 0 means unknown: no reset is invented.
	assert.Nil(t, r.Items[0].Reset)
}

func TestQueryNewApiSubscriptionNoActiveSub(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success": true, "data": {"subscriptions": []}}`))
	}))
	t.Cleanup(srv.Close)

	r := queryNewApiSubscriptionUsage(t.Context(), srv.Client(), srv.URL, map[string]string{"access_token": "t", "user_id": "1"})
	assert.Equal(t, "needs_configuration", r.Status)
}

func TestQueryNewApiSubscriptionAuthError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"success":false,"message":"unauthorized"}`))
	}))
	t.Cleanup(srv.Close)

	r := queryNewApiSubscriptionUsage(t.Context(), srv.Client(), srv.URL, map[string]string{"access_token": "bad", "user_id": "13"})
	assert.Equal(t, "authentication_error", r.Status)
}

func TestQueryNewApiSubscriptionBadCredential(t *testing.T) {
	r := queryNewApiSubscriptionUsage(t.Context(), &http.Client{}, "http://example.com", map[string]string{"user_id": "13"})
	assert.Equal(t, "needs_configuration", r.Status)
}
