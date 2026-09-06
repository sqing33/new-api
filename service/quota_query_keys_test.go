package service

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// These tests cover the per-key scan orchestration without any network: the
// non-multi-key, separate-credential, empty-credential and no-key paths all
// short-circuit before an upstream call, so a preset whose endpoint is never
// reachable in tests (kimi) proves no dial happened by returning its
// needs_configuration status instead of network_error.
func TestQueryChannelQuotaAllKeysNonMultiKeyNeedsConfiguration(t *testing.T) {
	ch := &model.Channel{
		Key:           "single-key",
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan"}`,
	}
	result := QueryChannelQuotaAllKeys(context.Background(), ch, nil)
	require.Len(t, result.Keys, 1)
	assert.Equal(t, "needs_configuration", result.Keys[0].Status)
	assert.False(t, result.IsMultiKey)
	assert.Empty(t, result.Keys[0].Items)
}

func TestQueryChannelQuotaAllKeysSeparateCredentialNeedsConfiguration(t *testing.T) {
	// Separate credential mode reads one shared credential channel, not the
	// per-key credentials: per-key scanning reports needs_configuration
	// without upstream calls (and without the referenced channel even
	// existing, since resolution is never attempted).
	ch := &model.Channel{
		Key:           "k1\nk2",
		ChannelInfo:   model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2},
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan","quota_query_credential_channel_id":999999}`,
	}
	result := QueryChannelQuotaAllKeys(context.Background(), ch, nil)
	require.Len(t, result.Keys, 1)
	assert.Equal(t, "needs_configuration", result.Keys[0].Status)
	assert.True(t, result.IsMultiKey)
}

func TestQueryChannelQuotaAllKeysSkipsEmptyCredentialsWithoutUpstreamCall(t *testing.T) {
	// Both keys are whitespace-only placeholders: every entry short-circuits
	// with needs_configuration. A kimi upstream query here would return
	// network_error, so this asserts no dial was attempted. (GetKeys trims
	// surrounding newlines, so the placeholders carry spaces.)
	ch := &model.Channel{
		Key:           " \n ",
		ChannelInfo:   model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2},
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan"}`,
	}
	result := QueryChannelQuotaAllKeys(context.Background(), ch, nil)
	require.Len(t, result.Keys, 2)
	assert.Equal(t, 0, result.Keys[0].KeyIndex)
	assert.Equal(t, 1, result.Keys[1].KeyIndex)
	for _, key := range result.Keys {
		assert.Equal(t, "needs_configuration", key.Status)
		assert.NotNil(t, key.Error)
	}
}

func TestQueryChannelQuotaAllKeysOutOfRangeIndexesSkippedNotFetched(t *testing.T) {
	// Only key 0 carries a non-empty credential; key 1 is a whitespace
	// placeholder, index 5 is out of range and must be silently dropped
	// rather than turned into an upstream call or a phantom result entry.
	ch := &model.Channel{
		Key:           "real\n ",
		ChannelInfo:   model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2},
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan"}`,
	}
	result := QueryChannelQuotaAllKeys(context.Background(), ch, []int{1, 5})
	require.Len(t, result.Keys, 1)
	assert.Equal(t, 1, result.Keys[0].KeyIndex)
	assert.Equal(t, "needs_configuration", result.Keys[0].Status)
}

func TestParseChannelKeyIndexes(t *testing.T) {
	indexes, err := ParseChannelKeyIndexes([]string{"0,1,2"})
	require.NoError(t, err)
	assert.Equal(t, []int{0, 1, 2}, indexes)

	indexes, err = ParseChannelKeyIndexes([]string{"0", "2"})
	require.NoError(t, err)
	assert.Equal(t, []int{0, 2}, indexes)

	indexes, err = ParseChannelKeyIndexes([]string{})
	require.NoError(t, err)
	assert.Empty(t, indexes)

	indexes, err = ParseChannelKeyIndexes([]string{" 1 , 3 "})
	require.NoError(t, err)
	assert.Equal(t, []int{1, 3}, indexes)

	for _, bad := range []string{"abc", "-1", "1.5", "1x", "99999999999999999999", "+1"} {
		_, err := ParseChannelKeyIndexes([]string{bad})
		assert.Error(t, err, "value %q must be rejected", bad)
	}
}
