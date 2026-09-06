package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/model"
)

// ChannelKeysQuotaUsage is the per-key plan-usage report of one multi-key
// channel. Items are NOT aggregated on the backend: each key keeps its own
// windows so the frontend decides how to display and aggregate them.
type ChannelKeysQuotaUsage struct {
	ChannelID  int                    `json:"channel_id"`
	IsMultiKey bool                   `json:"is_multi_key"`
	Keys       []ChannelKeyQuotaUsage `json:"keys"`
}

// ChannelKeyQuotaUsage is one key's plan-usage result. Status follows the
// stable QuotaUsage status contract (ok, needs_configuration, ...); keys
// that were skipped (empty credential, index out of range) report it via
// Status/Error without any upstream call.
type ChannelKeyQuotaUsage struct {
	KeyIndex  int              `json:"key_index"`
	Status    string           `json:"status"`
	Items     []QuotaUsageItem `json:"items"`
	FetchedAt string           `json:"fetched_at"`
	Error     *string          `json:"error"`
}

const (
	// quotaQueryAllKeysWorkers bounds the concurrent upstream queries when a
	// whole multi-key channel is scanned; the underlying per-key path also
	// enforces its own global slot limit.
	quotaQueryAllKeysWorkers = 4
	// quotaQueryAllKeysMax is the hard cap on keys scanned per request so a
	// channel with thousands of keys cannot fan out unbounded.
	quotaQueryAllKeysMax = 200
)

// QueryChannelQuotaAllKeys queries the bound quota-query preset once per key
// of a multi-key channel, running at most quotaQueryAllKeysWorkers upstream
// queries concurrently. keyIndexes nil means every index of ch.GetKeys();
// empty credentials are skipped with a needs_configuration result and never
// hit the network. Channels without a multi-key credential or in separate
// credential mode (the dedicated credential channel) cannot be scanned
// per-key and report needs_configuration without upstream calls.
func QueryChannelQuotaAllKeys(ctx context.Context, ch *model.Channel, keyIndexes []int) ChannelKeysQuotaUsage {
	result := ChannelKeysQuotaUsage{ChannelID: ch.Id, IsMultiKey: ch.ChannelInfo.IsMultiKey, Keys: []ChannelKeyQuotaUsage{}}
	if !ch.ChannelInfo.IsMultiKey {
		result.Keys = append(result.Keys, ChannelKeyQuotaUsage{Status: "needs_configuration", Items: []QuotaUsageItem{}})
		return result
	}
	otherSettings, err := ParseQuotaQuerySettings(ch.OtherSettings)
	if err != nil || otherSettings.QuotaQueryCredentialChannelID != nil {
		// Separate credential mode queries one shared credential, not the
		// per-key credentials; per-key scanning does not apply.
		result.Keys = append(result.Keys, ChannelKeyQuotaUsage{Status: "needs_configuration", Items: []QuotaUsageItem{}})
		return result
	}
	keys := ch.GetKeys()
	if len(keys) == 0 {
		result.Keys = append(result.Keys, ChannelKeyQuotaUsage{Status: "needs_configuration", Items: []QuotaUsageItem{}})
		return result
	}
	if len(keyIndexes) == 0 {
		keyIndexes = make([]int, len(keys))
		for i := range keyIndexes {
			keyIndexes[i] = i
		}
	}
	// Deduplicate while preserving order; validate against the key count.
	requested := make([]int, 0, len(keyIndexes))
	seen := make(map[int]bool, len(keyIndexes))
	for _, idx := range keyIndexes {
		if idx < 0 || idx >= len(keys) || seen[idx] {
			continue
		}
		seen[idx] = true
		requested = append(requested, idx)
		if len(requested) >= quotaQueryAllKeysMax {
			break
		}
	}
	if len(requested) == 0 {
		result.Keys = append(result.Keys, ChannelKeyQuotaUsage{Status: "needs_configuration", Items: []QuotaUsageItem{}})
		return result
	}
	results := make([]ChannelKeyQuotaUsage, len(requested))
	var wg sync.WaitGroup
	sem := make(chan struct{}, quotaQueryAllKeysWorkers)
	for i, keyIndex := range requested {
		// Empty credentials must not consume upstream slots: resolve the
		// credential per key before dispatching to the pool.
		if strings.TrimSpace(keys[keyIndex]) == "" {
			status := "needs_configuration"
			results[i] = ChannelKeyQuotaUsage{KeyIndex: keyIndex, Status: status, Items: []QuotaUsageItem{}, Error: &status}
			continue
		}
		wg.Add(1)
		select {
		case sem <- struct{}{}:
		case <-ctx.Done():
			// Caller gone: stop queueing further keys; in-flight queries
			// observe cancellation through the shared ctx.
			wg.Done()
			continue
		}
		go func(slot int, keyIndex int) {
			defer wg.Done()
			defer func() { <-sem }()
			// The bounded-slot, singleflight, TTL-cached per-key path is
			// reused unchanged; ctx cancellation is honored there.
			usage := QueryChannelQuotaWithOption(ctx, ch, false, QuotaQueryOption{KeyIndex: &keyIndex})
			entry := ChannelKeyQuotaUsage{KeyIndex: keyIndex, Status: usage.Status, Items: usage.Items, FetchedAt: usage.FetchedAt, Error: usage.Error}
			if entry.Items == nil {
				entry.Items = []QuotaUsageItem{}
			}
			results[slot] = entry
		}(i, keyIndex)
	}
	wg.Wait()
	result.Keys = append(result.Keys, results...)
	return result
}

// ParseChannelKeyIndexes parses the repeatable/comma-separated
// ?key_indexes=... parameter (e.g. "0,1,2" or key_indexes=0&key_indexes=2).
func ParseChannelKeyIndexes(raw []string) ([]int, error) {
	indexes := make([]int, 0, len(raw))
	for _, part := range raw {
		for _, piece := range strings.Split(part, ",") {
			piece = strings.TrimSpace(piece)
			if piece == "" {
				continue
			}
			idx, err := strconv.Atoi(piece)
			if err != nil || idx < 0 || strings.HasPrefix(piece, "+") {
				return nil, fmt.Errorf("invalid key_indexes value %q", piece)
			}
			indexes = append(indexes, idx)
		}
	}
	return indexes, nil
}
