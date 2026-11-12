package service

import (
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPinnedTaskPluginChannelTypesUsesPinnedGenerationIndex(t *testing.T) {
	registry := jsplugin.NewRegistry()
	plugin, err := registry.Register(channelSelectTaskPluginSource("legacy-select", constant.ChannelTypeKling), jsplugin.Options{})
	require.NoError(t, err)

	c, _ := gin.CreateTestContext(nil)
	c.Set(jsplugin.ContextKeyPinnedPlugin, jsplugin.PinnedPlugin{
		Generation: registry.Generation(),
		Plugin:     plugin,
	})

	types, keys := pinnedTaskPluginIdentities(c, "legacy-select")
	assert.Equal(t, []int{constant.ChannelTypeKling}, types)
	assert.Equal(t, []string{"legacy-select"}, keys)
	types, keys = pinnedTaskPluginIdentities(c, "another-plugin")
	assert.Empty(t, types)
	assert.Empty(t, keys)
	types, keys = pinnedTaskPluginIdentities(nil, "legacy-select")
	assert.Empty(t, types)
	assert.Empty(t, keys)
}

func TestPinnedTaskPluginChannelTypesLeavesGenericChannelsKeyed(t *testing.T) {
	registry := jsplugin.NewRegistry()
	plugin, err := registry.Register(channelSelectTaskPluginSource("generic-select", constant.ChannelTypeTaskPlugin), jsplugin.Options{})
	require.NoError(t, err)

	c, _ := gin.CreateTestContext(nil)
	c.Set(jsplugin.ContextKeyPinnedPlugin, jsplugin.PinnedPlugin{
		Generation: registry.Generation(),
		Plugin:     plugin,
	})

	types, keys := pinnedTaskPluginIdentities(c, "generic-select")
	assert.Empty(t, types)
	assert.Equal(t, []string{"generic-select"}, keys)
}

func TestPinnedTaskPluginChannelTypesIncludesSharedEndpointProviders(t *testing.T) {
	registry := jsplugin.NewRegistry()
	_, err := registry.Register(channelSelectEndpointPluginSource("gemini-select", constant.ChannelTypeGemini), jsplugin.Options{})
	require.NoError(t, err)
	_, err = registry.Register(channelSelectEndpointPluginSource("vertex-select", constant.ChannelTypeVertexAi), jsplugin.Options{})
	require.NoError(t, err)
	candidates := registry.Generation().LookupEndpointCandidates("POST", "/v1/responses", "task-model")
	require.Len(t, candidates, 2)

	c, _ := gin.CreateTestContext(nil)
	c.Set(jsplugin.ContextKeyPinnedPlugin, jsplugin.PinnedPlugin{
		Generation: registry.Generation(),
		Plugin:     candidates[0].Plugin,
	})
	c.Set(jsplugin.ContextKeyPinnedEndpoint, jsplugin.PinnedEndpoint{
		Generation: registry.Generation(),
		Plugin:     candidates[0].Plugin,
		Protocol:   candidates[0].Protocol,
		Operation:  candidates[0].Operation,
		Model:      "task-model",
		Candidates: candidates,
	})

	AppendTaskPluginIdentityFilter(c, candidates[0].Plugin.Meta.Key)
	filters := GetChannelConstraints(c).Filters
	require.Len(t, filters, 1)
	assert.Equal(t, []int{constant.ChannelTypeGemini, constant.ChannelTypeVertexAi}, filters[0].TaskPluginChannelTypes)
	assert.Equal(t, []string{"gemini-select", "vertex-select"}, filters[0].TaskPluginKeys)
}

func channelSelectTaskPluginSource(key string, channelType int) string {
	return fmt.Sprintf(`
export const meta = {
  apiVersion: 1,
  key: %q,
  name: %q,
  version: "1.0.0",
  author: {name: "Test"},
  %s
  models: ["task-model"],
  fetchMode: "per_task",
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {taskId: "task"}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {status: "SUCCESS"}; }
`, key, key, channelSelectChannelTypesField(channelType))
}

func channelSelectEndpointPluginSource(key string, channelType int) string {
	return fmt.Sprintf(`
export const meta = {
  apiVersion: 1,
  key: %q,
  name: %q,
  version: "1.0.0",
  author: {name: "Test"},
  %s
  models: ["task-model"],
  fetchMode: "per_task",
  protocols: [{name: "openai_responses", supports: ["stream", "sync", "background"]}],
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {taskId: "task"}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {status: "SUCCESS"}; }
export const protocols = {openai_responses: {
  decodeRequest: function(ctx) { return {kind: "submit", model: "task-model", requestBody: ctx.body.value}; },
  renderEvents: function() { return {events: [], state: null, done: false}; },
  renderFinal: function() { return {output: []}; },
}};
`, key, key, channelSelectChannelTypesField(channelType))
}

func channelSelectChannelTypesField(channelType int) string {
	if channelType <= 0 || channelType == constant.ChannelTypeTaskPlugin {
		return ""
	}
	return fmt.Sprintf("channelTypes: [%d],", channelType)
}

func TestPinnedTaskPluginChannelTypesIncludesCompatibleTypes(t *testing.T) {
	registry := jsplugin.NewRegistry()
	plugin, err := registry.Register(channelSelectCompatiblePluginSource("sora-select", constant.ChannelTypeSora, constant.ChannelTypeOpenAI), jsplugin.Options{})
	require.NoError(t, err)

	c, _ := gin.CreateTestContext(nil)
	c.Set(jsplugin.ContextKeyPinnedPlugin, jsplugin.PinnedPlugin{
		Generation: registry.Generation(),
		Plugin:     plugin,
	})

	types, keys := pinnedTaskPluginIdentities(c, "sora-select")
	assert.Equal(t, []int{constant.ChannelTypeSora, constant.ChannelTypeOpenAI}, types)
	assert.Equal(t, []string{"sora-select"}, keys)
}

func channelSelectCompatiblePluginSource(key string, channelType, compatibleType int) string {
	return fmt.Sprintf(`
export const meta = {
  apiVersion: 1,
  key: %q,
  name: %q,
  version: "1.0.0",
  author: {name: "Test"},
  channelTypes: [%d, %d],
  models: ["task-model"],
  fetchMode: "per_task",
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {taskId: "task"}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {status: "SUCCESS"}; }
`, key, key, channelType, compatibleType)
}

func TestSharedType61IdentityFilterContainsAllCandidateKeys(t *testing.T) {
	registry := jsplugin.NewRegistry()
	for _, key := range []string{"alpha", "beta"} {
		_, err := registry.Register(channelSelectEndpointPluginSource(key, 0), jsplugin.Options{})
		require.NoError(t, err)
	}
	generation := registry.Generation()
	candidates := generation.LookupEndpointCandidates("POST", "/v1/responses", "task-model")
	require.Len(t, candidates, 2)
	c, _ := gin.CreateTestContext(nil)
	c.Set(jsplugin.ContextKeyPinnedEndpoint, jsplugin.PinnedEndpoint{Generation: generation, Plugin: candidates[0].Plugin, Candidates: candidates})
	AppendTaskPluginIdentityFilter(c, "alpha")
	filters := GetChannelConstraints(c).Filters
	require.Len(t, filters, 1)
	assert.Equal(t, "alpha", filters[0].TaskPluginKey)
	assert.Equal(t, []string{"alpha", "beta"}, filters[0].TaskPluginKeys)
	assert.Empty(t, filters[0].TaskPluginChannelTypes)
}

func TestAdvanceAfterFailureSpendsSameChannelBudgetFirst(t *testing.T) {
	policy := RetryPolicy{PriorityRetries: 1, SameChannelRetries: 3}
	param := &RetryParam{}

	// Three in-place retries, all pinned to the channel that just failed.
	for spent := 1; spent <= 3; spent++ {
		require.True(t, param.AdvanceAfterFailure(RetryAttemptOutcome{Elapsed: time.Millisecond, ChannelId: 30}, policy))
		assert.Equal(t, spent, param.SameChannelRetry)
		assert.Equal(t, 30, param.LockedChannelId)
		assert.Equal(t, 0, param.GetRetry(), "same-channel retries must not drop a priority tier")
	}

	// Budget exhausted: drop one tier and clear the pin.
	require.True(t, param.AdvanceAfterFailure(RetryAttemptOutcome{Elapsed: time.Millisecond, ChannelId: 30}, policy))
	assert.Equal(t, 1, param.GetRetry())
	assert.Zero(t, param.SameChannelRetry)
	assert.Zero(t, param.LockedChannelId)
}

func TestAdvanceAfterFailureRetriesSameChannelWithNoPriorityBudget(t *testing.T) {
	// RetryTimes=0 must not disable same-channel retries: the two budgets are
	// independent, which is the reason ChannelRetryTimes exists.
	policy := RetryPolicy{PriorityRetries: 0, SameChannelRetries: 3}
	param := &RetryParam{}

	require.True(t, param.AdvanceAfterFailure(RetryAttemptOutcome{ChannelId: 7}, policy))
	assert.Equal(t, 7, param.LockedChannelId)
	assert.Equal(t, 0, param.GetRetry())

	param.AdvanceAfterFailure(RetryAttemptOutcome{ChannelId: 7}, policy)
	param.AdvanceAfterFailure(RetryAttemptOutcome{ChannelId: 7}, policy)
	assert.False(t, param.AdvanceAfterFailure(RetryAttemptOutcome{ChannelId: 7}, policy), "no priority budget left after the same-channel budget is spent")
}

func TestAdvanceAfterFailureStopsAfterConsecutiveSlowFailures(t *testing.T) {
	policy := RetryPolicy{
		PriorityRetries:    1,
		SameChannelRetries: 3,
		SlowFailThreshold:  120 * time.Second,
		SlowFailCount:      2,
	}
	param := &RetryParam{}

	require.True(t, param.AdvanceAfterFailure(RetryAttemptOutcome{Elapsed: 121 * time.Second, ChannelId: 30}, policy))
	assert.Equal(t, 1, param.ConsecutiveSlowFailures)
	assert.Equal(t, 1, param.SameChannelRetry)

	// Second slow failure exhausts the same-channel budget early, so the next
	// attempt jumps to the next priority tier instead of waiting out 3 retries.
	require.True(t, param.AdvanceAfterFailure(RetryAttemptOutcome{Elapsed: 121 * time.Second, ChannelId: 30}, policy))
	assert.Equal(t, 1, param.GetRetry(), "slow failures drop the tier without spending the full budget")
	assert.Zero(t, param.LockedChannelId)
}

func TestAdvanceAfterFailureResetsSlowFailureStreakOnFastAttempt(t *testing.T) {
	policy := RetryPolicy{
		PriorityRetries:    2,
		SameChannelRetries: 3,
		SlowFailThreshold:  120 * time.Second,
		SlowFailCount:      2,
	}
	param := &RetryParam{}

	require.True(t, param.AdvanceAfterFailure(RetryAttemptOutcome{Elapsed: 121 * time.Second, ChannelId: 30}, policy))
	require.True(t, param.AdvanceAfterFailure(RetryAttemptOutcome{Elapsed: 2 * time.Second, ChannelId: 30}, policy))
	assert.Zero(t, param.ConsecutiveSlowFailures, "a fast failure breaks the streak")
	assert.Equal(t, 2, param.SameChannelRetry)
	assert.Equal(t, 0, param.GetRetry(), "streak reset keeps the normal same-channel budget")
}

func TestAdvanceAfterFailureIgnoresSlowFailuresWhenDisabled(t *testing.T) {
	for _, policy := range []RetryPolicy{
		{PriorityRetries: 1, SameChannelRetries: 3},                                 // threshold unset
		{PriorityRetries: 1, SameChannelRetries: 3, SlowFailThreshold: time.Minute}, // count unset
	} {
		param := &RetryParam{}
		require.True(t, param.AdvanceAfterFailure(RetryAttemptOutcome{Elapsed: time.Hour, ChannelId: 30}, policy))
		assert.Zero(t, param.ConsecutiveSlowFailures)
		assert.Equal(t, 1, param.SameChannelRetry)
	}
}

func TestRetryPolicyMaxAttemptsMultipliesBothBudgets(t *testing.T) {
	assert.Equal(t, 4, RetryPolicy{PriorityRetries: 0, SameChannelRetries: 3}.MaxAttempts())
	assert.Equal(t, 8, RetryPolicy{PriorityRetries: 1, SameChannelRetries: 3}.MaxAttempts())
	assert.Equal(t, 1, RetryPolicy{}.MaxAttempts(), "no budget still leaves the first attempt")
}

func TestAdvanceAfterFailureClearsSlowStreakAcrossTierDrop(t *testing.T) {
	// A slowdown seen on one channel must not shorten the next channel's budget.
	policy := RetryPolicy{
		PriorityRetries:    1,
		SameChannelRetries: 3,
		SlowFailThreshold:  120 * time.Second,
		SlowFailCount:      2,
	}
	param := &RetryParam{}
	require.True(t, param.AdvanceAfterFailure(RetryAttemptOutcome{Elapsed: 121 * time.Second, ChannelId: 30}, policy))
	// Budget exhausted by the slow rule: this failure drops the tier.
	require.True(t, param.AdvanceAfterFailure(RetryAttemptOutcome{Elapsed: 121 * time.Second, ChannelId: 30}, policy))
	require.Equal(t, 1, param.GetRetry())
	assert.Zero(t, param.ConsecutiveSlowFailures, "a tier drop starts a clean streak for the new channel")

	// The next channel gets its full in-place budget even after a slow failure.
	require.True(t, param.AdvanceAfterFailure(RetryAttemptOutcome{Elapsed: 121 * time.Second, ChannelId: 41}, policy))
	assert.Equal(t, 41, param.LockedChannelId)
	assert.Equal(t, 1, param.SameChannelRetry)
}

func TestExhaustedChannelIdsUsesPerChannelTotals(t *testing.T) {
	param := &RetryParam{}
	for range 4 {
		param.RecordChannelAttempt(36)
	}
	param.RecordChannelAttempt(37)

	exhausted := param.ExhaustedChannelIds(4)
	assert.Contains(t, exhausted, 36)
	assert.NotContains(t, exhausted, 37)
	assert.Equal(t, 4, param.ChannelAttemptCount(36))
}

func TestExhaustedChannelIdsDisabledWithoutPerChannelCap(t *testing.T) {
	param := &RetryParam{}
	for range 10 {
		param.RecordChannelAttempt(36)
	}
	assert.Nil(t, param.ExhaustedChannelIds(0))
}

func TestRetryBudgetStopsSingleChannelFromSpinning(t *testing.T) {
	// A model served by exactly one channel must not spend the whole
	// (tiers+1)*(retries+1) allowance on it: the per-channel total caps it, so
	// the loop stops instead of issuing 16 identical attempts.
	policy := RetryPolicy{PriorityRetries: 3, SameChannelRetries: 3}
	param := &RetryParam{MaxAttemptsPerChannel: policy.SameChannelRetries + 1}

	attempts := 0
	for attempt := 1; attempt <= policy.MaxAttempts(); attempt++ {
		exhausted := param.ExhaustedChannelIds(param.MaxAttemptsPerChannel)
		if _, skip := exhausted[36]; skip {
			break
		}
		param.RecordChannelAttempt(36)
		attempts++
		if !param.AdvanceAfterFailure(RetryAttemptOutcome{ChannelId: 36}, policy) {
			break
		}
	}
	assert.Equal(t, 4, attempts, "one channel gets the first attempt plus ChannelRetryTimes retries")
}

func TestSharedNativeRouteIdentityFilterContainsAllCandidateKeys(t *testing.T) {
	registry := jsplugin.NewRegistry()
	for _, key := range []string{"route-alpha", "route-beta"} {
		_, err := registry.Register(fmt.Sprintf(`
export const meta = {apiVersion: 1, key: %q, name: %q, version: "1.0.0", author: {name: "Test"}, models: ["task-model"], fetchMode: "per_task",
	routes: [{method: "POST", path: "/probe/v1/jobs", type: "submit", decode: "decode", render: "render"}]};
export const native = {decode() { return {}; }, render() { return {}; }};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {}; }
`, key, key), jsplugin.Options{})
		require.NoError(t, err)
	}
	generation := registry.Generation()
	candidates := generation.LookupDeclaredRoutes("POST", "/probe/v1/jobs")
	require.Len(t, candidates, 2)
	c, _ := gin.CreateTestContext(nil)
	c.Set(jsplugin.ContextKeyPinnedRoute, jsplugin.PinnedRoute{Generation: generation, Plugin: candidates[0].Plugin, Route: candidates[0].Route, Candidates: candidates})
	AppendTaskPluginIdentityFilter(c, "route-alpha")
	filters := GetChannelConstraints(c).Filters
	require.Len(t, filters, 1)
	assert.Equal(t, "route-alpha", filters[0].TaskPluginKey)
	assert.Equal(t, []string{"route-alpha", "route-beta"}, filters[0].TaskPluginKeys)
}
