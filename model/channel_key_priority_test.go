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

package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

func setupKeyPriorityTest(t *testing.T) {
	t.Helper()
	// Polling mode reads ChannelInfo through the cache path; disable the
	// in-memory cache so the just-inserted row is read straight from DB.
	memoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = memoryCacheEnabled
	})
	require.NoError(t, DB.Exec("DELETE FROM abilities").Error)
	require.NoError(t, DB.Exec("DELETE FROM channels").Error)
}

func newPriorityTestChannel(keys string, mode constant.MultiKeyMode, priority map[int]int, status map[int]int) *Channel {
	ch := &Channel{
		Id:   1,
		Key:  keys,
		Type: 1,
	}
	ch.ChannelInfo.IsMultiKey = true
	ch.ChannelInfo.MultiKeyMode = mode
	ch.ChannelInfo.MultiKeyPriority = priority
	ch.ChannelInfo.MultiKeyStatusList = status
	return ch
}

func TestGetNextEnabledKeyStrictPriorityRandom(t *testing.T) {
	setupKeyPriorityTest(t)
	// Key 1 holds priority 10; every draw must come from the top tier.
	ch := newPriorityTestChannel("k0\nk1\nk2", constant.MultiKeyModeRandom, map[int]int{1: 10}, nil)
	for i := 0; i < 50; i++ {
		key, idx, apiErr := ch.GetNextEnabledKey()
		require.Nil(t, apiErr)
		assert.Equal(t, "k1", key)
		assert.Equal(t, 1, idx)
	}
}

func TestGetNextEnabledKeyFallsBackWhenTopTierDisabled(t *testing.T) {
	setupKeyPriorityTest(t)
	// Top tier (key 1, priority 10) is disabled -> next tier (key 2, priority 5) serves.
	ch := newPriorityTestChannel("k0\nk1\nk2", constant.MultiKeyModeRandom,
		map[int]int{1: 10, 2: 5}, map[int]int{1: common.ChannelStatusManuallyDisabled})
	for i := 0; i < 20; i++ {
		key, idx, apiErr := ch.GetNextEnabledKey()
		require.Nil(t, apiErr)
		assert.Equal(t, "k2", key)
		assert.Equal(t, 2, idx)
	}
}

func TestGetNextEnabledKeyAllDefaultPriorityKeepsLegacyBehavior(t *testing.T) {
	setupKeyPriorityTest(t)
	// No priority entries: all keys form one tier, random mode may pick any.
	ch := newPriorityTestChannel("k0\nk1", constant.MultiKeyModeRandom, nil, nil)
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		key, _, apiErr := ch.GetNextEnabledKey()
		require.Nil(t, apiErr)
		seen[key] = true
	}
	assert.True(t, seen["k0"] && seen["k1"], "all-default keys must stay eligible")
}

func TestGetNextEnabledKeyZeroAndMissingEntriesEqual(t *testing.T) {
	setupKeyPriorityTest(t)
	// Explicit zero equals a missing entry: both are the default tier and
	// lose to any positive priority.
	ch := newPriorityTestChannel("k0\nk1\nk2", constant.MultiKeyModeRandom,
		map[int]int{0: 0, 1: 3, 2: 0}, nil)
	for i := 0; i < 30; i++ {
		key, idx, apiErr := ch.GetNextEnabledKey()
		require.Nil(t, apiErr)
		assert.Equal(t, "k1", key)
		assert.Equal(t, 1, idx)
	}
}

func TestGetNextEnabledKeyPollingWithinTopTier(t *testing.T) {
	setupKeyPriorityTest(t)
	ch := newPriorityTestChannel("k0\nk1\nk2", constant.MultiKeyModePolling,
		map[int]int{0: 7, 2: 7}, nil)
	require.NoError(t, DB.Create(ch).Error)
	// Polling must rotate within the top tier (keys 0 and 2, priority 7),
	// never touching the lower-tier key 1.
	seen := map[string]bool{}
	for i := 0; i < 20; i++ {
		key, _, apiErr := ch.GetNextEnabledKey()
		require.Nil(t, apiErr)
		seen[key] = true
	}
	assert.True(t, seen["k0"] && seen["k2"], "polling covers the whole top tier")
	assert.False(t, seen["k1"], "lower tier must never serve while the top tier is enabled")
}

func TestGetNextEnabledKeyNegativePriorityTreatedAsDefault(t *testing.T) {
	setupKeyPriorityTest(t)
	// A negative entry is treated the same as the default tier 0 (the
	// manage API rejects negatives; this only guards hand-edited JSON), so
	// both keys stay eligible and behavior matches the legacy random mode.
	ch := newPriorityTestChannel("k0\nk1", constant.MultiKeyModeRandom,
		map[int]int{1: -5}, nil)
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		key, _, apiErr := ch.GetNextEnabledKey()
		require.Nil(t, apiErr)
		seen[key] = true
	}
	assert.True(t, seen["k0"] && seen["k1"], "negative priority degrades to the default tier, not below it")
}
