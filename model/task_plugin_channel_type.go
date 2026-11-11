package model

import (
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// GetEnabledChannelTypesForModel returns the distinct channel types of every
// enabled channel that can serve modelName in any group. It exists for routing
// decisions that must run before channel selection — a task-plugin pin needs to
// know which providers could serve a model in order to infer the driving
// plugin, and at pin time no channel has been chosen yet.
//
// The memory-cache path mirrors GetRandomSatisfiedChannel's two-step lookup
// (exact model name, then the normalized routing name); the database path is
// used when the cache is disabled. Both consider only enabled channels, because
// a disabled channel must not make a plugin look available.
func GetEnabledChannelTypesForModel(modelName string) []int {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return nil
	}

	if !common.MemoryCacheEnabled {
		return enabledChannelTypesFromDatabase(modelName)
	}

	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	seen := make(map[int]struct{})
	collect := func(candidate string) {
		for _, model2channels := range group2model2channels {
			for _, channelId := range model2channels[candidate] {
				channel, ok := channelsIDM[channelId]
				if !ok || channel == nil {
					continue
				}
				if channel.Status != common.ChannelStatusEnabled {
					continue
				}
				seen[channel.Type] = struct{}{}
			}
		}
	}
	collect(modelName)
	if len(seen) == 0 {
		if normalized := ratio_setting.RoutingMatchModelName(modelName); normalized != modelName {
			collect(normalized)
		}
	}
	return sortedChannelTypes(seen)
}

func enabledChannelTypesFromDatabase(modelName string) []int {
	var abilities []Ability
	if err := DB.Where("model = ? and enabled = ?", modelName, true).Find(&abilities).Error; err != nil {
		return nil
	}
	if len(abilities) == 0 {
		return nil
	}
	channelIds := make([]int, 0, len(abilities))
	seenIds := make(map[int]struct{}, len(abilities))
	for _, ability := range abilities {
		if _, ok := seenIds[ability.ChannelId]; ok {
			continue
		}
		seenIds[ability.ChannelId] = struct{}{}
		channelIds = append(channelIds, ability.ChannelId)
	}
	var channels []*Channel
	if err := DB.Where("id IN ?", channelIds).Find(&channels).Error; err != nil {
		return nil
	}
	seen := make(map[int]struct{}, len(channels))
	for _, channel := range channels {
		if channel == nil || channel.Status != common.ChannelStatusEnabled {
			continue
		}
		seen[channel.Type] = struct{}{}
	}
	return sortedChannelTypes(seen)
}

func sortedChannelTypes(seen map[int]struct{}) []int {
	if len(seen) == 0 {
		return nil
	}
	types := make([]int, 0, len(seen))
	for channelType := range seen {
		types = append(types, channelType)
	}
	sort.Ints(types)
	return types
}
