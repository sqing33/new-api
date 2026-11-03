package concurrency

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setMiniRedisTimeOnScriptHook pins the clock seen by redis.call('TIME') inside
// the Lua script. It must match both "eval" and "evalsha" because the tracker
// pipelines EVALSHA and only falls back to EVAL after a NOSCRIPT. "time" is
// included because the batch reader takes its cutoff from a separate TIME call
// that must observe the same pinned clock.
//
// The target time is read through a getter so a test can advance the clock
// between operations without rebuilding the hook.
type setMiniRedisTimeOnScriptHook struct {
	server *miniredis.Miniredis
	now    func() time.Time
}

func (hook setMiniRedisTimeOnScriptHook) BeforeProcess(ctx context.Context, cmd redis.Cmder) (context.Context, error) {
	switch cmd.Name() {
	case "eval", "evalsha", "time":
		hook.server.SetTime(hook.now())
	}
	return ctx, nil
}

func (setMiniRedisTimeOnScriptHook) AfterProcess(context.Context, redis.Cmder) error {
	return nil
}

func (setMiniRedisTimeOnScriptHook) BeforeProcessPipeline(ctx context.Context, _ []redis.Cmder) (context.Context, error) {
	return ctx, nil
}

func (setMiniRedisTimeOnScriptHook) AfterProcessPipeline(context.Context, []redis.Cmder) error {
	return nil
}

func useMiniRedis(t *testing.T) (*miniredis.Miniredis, *redis.Client) {
	t.Helper()

	previousRedisEnabled := common.RedisEnabled
	previousRedisClient := common.RDB
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	require.NoError(t, client.Ping(context.Background()).Err())

	common.RedisEnabled = true
	common.RDB = client
	t.Cleanup(func() {
		_ = client.Close()
		common.RedisEnabled = previousRedisEnabled
		common.RDB = previousRedisClient
	})
	return server, client
}

// useMiniRedisAtTime additionally pins the script clock so TTL expiry is
// deterministic instead of depending on wall-clock sleeps. The returned setter
// advances the pinned clock for subsequent operations.
func useMiniRedisAtTime(t *testing.T, at time.Time) (*miniredis.Miniredis, func(time.Time)) {
	t.Helper()
	server, client := useMiniRedis(t)

	var mu sync.Mutex
	current := at
	client.AddHook(setMiniRedisTimeOnScriptHook{
		server: server,
		now: func() time.Time {
			mu.Lock()
			defer mu.Unlock()
			return current
		},
	})
	setTime := func(next time.Time) {
		mu.Lock()
		current = next
		mu.Unlock()
		server.SetTime(next)
	}
	setTime(at)
	return server, setTime
}

func fullDimensions() Dimensions {
	return Dimensions{ChannelID: 11, UserID: 22, TokenID: 33}
}

func countAll(t *testing.T, dims Dimensions) (int, int, int) {
	t.Helper()
	channel := BatchCount(DimensionChannel, []int{dims.ChannelID})[dims.ChannelID]
	user := BatchCount(DimensionUser, []int{dims.UserID})[dims.UserID]
	token := BatchCount(DimensionToken, []int{dims.TokenID})[dims.TokenID]
	return channel, user, token
}

func TestTrackAndCountAcrossAllDimensions(t *testing.T) {
	useMiniRedis(t)

	dims := fullDimensions()
	Track(context.Background(), dims, NewRequestID())

	channel, user, token := countAll(t, dims)
	assert.Equal(t, 1, channel, "channel dimension")
	assert.Equal(t, 1, user, "user dimension")
	assert.Equal(t, 1, token, "token dimension")
}

func TestTrackAccumulatesDistinctRequests(t *testing.T) {
	useMiniRedis(t)

	dims := fullDimensions()
	for range 3 {
		Track(context.Background(), dims, NewRequestID())
	}

	channel, user, token := countAll(t, dims)
	assert.Equal(t, 3, channel)
	assert.Equal(t, 3, user)
	assert.Equal(t, 3, token)
}

func TestTrackIsIdempotentForSameRequestID(t *testing.T) {
	useMiniRedis(t)

	dims := fullDimensions()
	requestID := NewRequestID()
	Track(context.Background(), dims, requestID)
	Track(context.Background(), dims, requestID)

	channel, _, _ := countAll(t, dims)
	assert.Equal(t, 1, channel, "re-tracking the same request must not double count")
}

func TestReleaseClearsAllDimensions(t *testing.T) {
	useMiniRedis(t)

	dims := fullDimensions()
	requestID := NewRequestID()
	Track(context.Background(), dims, requestID)

	Release(dims, requestID)()

	channel, user, token := countAll(t, dims)
	assert.Equal(t, 0, channel)
	assert.Equal(t, 0, user)
	assert.Equal(t, 0, token)
}

func TestReleaseIsIdempotent(t *testing.T) {
	useMiniRedis(t)

	dims := fullDimensions()
	requestID := NewRequestID()
	Track(context.Background(), dims, requestID)

	release := Release(dims, requestID)
	release()
	release()

	channel, _, _ := countAll(t, dims)
	assert.Equal(t, 0, channel, "double release must not underflow the count")

	// A slot released twice must not resurrect or corrupt other members.
	Track(context.Background(), dims, NewRequestID())
	channel, _, _ = countAll(t, dims)
	assert.Equal(t, 1, channel)
}

func TestSkipsUnpopulatedDimensions(t *testing.T) {
	server, _ := useMiniRedis(t)

	dims := Dimensions{ChannelID: 7}
	Track(context.Background(), dims, NewRequestID())

	assert.Equal(t, 1, BatchCount(DimensionChannel, []int{7})[7])
	assert.Equal(t, 0, BatchCount(DimensionUser, []int{0})[0])
	assert.Equal(t, 0, BatchCount(DimensionToken, []int{0})[0])

	keys := server.Keys()
	require.Len(t, keys, 1, "only the populated dimension may create a key")
	assert.Equal(t, "concurrency:v1:channel:7", keys[0])
}

func TestExpiredSlotsAreReclaimed(t *testing.T) {
	base := time.Unix(1_700_000_000, 0)
	_, setTime := useMiniRedisAtTime(t, base)

	dims := fullDimensions()
	Track(context.Background(), dims, NewRequestID())
	require.Equal(t, 1, BatchCount(DimensionChannel, []int{dims.ChannelID})[dims.ChannelID])

	// Advance past the slot TTL; the next read must trim the stale member.
	// SlotTTLSeconds is an untyped constant, so it must be widened to seconds
	// explicitly or the offset collapses to nanoseconds.
	setTime(base.Add(time.Duration(SlotTTLSeconds)*time.Second + time.Minute))

	channel, user, token := countAll(t, dims)
	assert.Equal(t, 0, channel, "expired channel slot")
	assert.Equal(t, 0, user, "expired user slot")
	assert.Equal(t, 0, token, "expired token slot")
}

// TestTrackSurvivesScriptCacheFlush covers the NOSCRIPT path: the tracker
// pipelines EVALSHA, which fails after a Redis flush, and must retry with EVAL.
func TestTrackSurvivesScriptCacheFlush(t *testing.T) {
	server, client := useMiniRedis(t)

	dims := fullDimensions()
	Track(context.Background(), dims, NewRequestID())
	require.Equal(t, 1, BatchCount(DimensionChannel, []int{dims.ChannelID})[dims.ChannelID])

	// Drop both the script cache and the data, simulating a flushed Redis.
	require.NoError(t, client.ScriptFlush(context.Background()).Err())
	require.NoError(t, client.FlushAll(context.Background()).Err())
	require.False(t, server.Exists("concurrency:v1:channel:11"))

	Track(context.Background(), dims, NewRequestID())

	channel, user, token := countAll(t, dims)
	assert.Equal(t, 1, channel, "track must recover after NOSCRIPT")
	assert.Equal(t, 1, user)
	assert.Equal(t, 1, token)
}

func TestDisabledRedisIsSilent(t *testing.T) {
	_, client := useMiniRedis(t)

	dims := fullDimensions()
	previous := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = previous })

	assert.NotPanics(t, func() {
		Track(context.Background(), dims, NewRequestID())
		Release(dims, NewRequestID())()
	})

	counts := BatchCount(DimensionChannel, []int{dims.ChannelID})
	assert.Equal(t, 0, counts[dims.ChannelID])

	// Nothing may reach Redis while disabled.
	assert.Empty(t, client.Keys(context.Background(), "*").Val())
}

func TestConcurrentTracksAreNotLost(t *testing.T) {
	useMiniRedis(t)

	const requests = 60
	dims := fullDimensions()

	var wg sync.WaitGroup
	for range requests {
		wg.Add(1)
		go func() {
			defer wg.Done()
			Track(context.Background(), dims, NewRequestID())
		}()
	}
	wg.Wait()

	channel, user, token := countAll(t, dims)
	assert.Equal(t, requests, channel)
	assert.Equal(t, requests, user)
	assert.Equal(t, requests, token)
}

func TestBatchCountHandlesMissingAndInvalidIDs(t *testing.T) {
	useMiniRedis(t)

	dims := Dimensions{ChannelID: 5}
	Track(context.Background(), dims, NewRequestID())

	counts := BatchCount(DimensionChannel, []int{5, 6, 0, -1})
	assert.Equal(t, 1, counts[5])
	assert.Equal(t, 0, counts[6], "unknown id")
	assert.Equal(t, 0, counts[0], "zero id")
	assert.Equal(t, 0, counts[-1], "negative id")
}

// TestDimensionMemberRoundTrips 覆盖分维度 member：Track 与 Release 必须用
// 同一个 member 串，否则 Release 删不掉槽位，并发会一直虚高到 TTL 过期。
func TestDimensionMemberRoundTrips(t *testing.T) {
	useMiniRedis(t)

	dims := Dimensions{
		ChannelID: 11, UserID: 22, TokenID: 33,
		Model: "gpt-test", Group: "default",
	}
	requestID := NewRequestID()

	Track(context.Background(), dims, requestID)
	channel, _, _ := countAll(t, dims)
	require.Equal(t, 1, channel, "track should register the request")

	breakdown, err := CountByDimension(DimensionChannel, dims.ChannelID)
	require.NoError(t, err)
	require.Equal(t, 1, breakdown["gpt-test|default"], "member should carry model|group")

	// 释放后槽位必须消失：这是 member 一致性的关键断言
	Release(dims, requestID)()
	channel, _, _ = countAll(t, dims)
	assert.Equal(t, 0, channel, "release should remove the exact member")
}

// TestCountByDimensionSeparatesModels 验证不同 model/group 落在不同桶里。
func TestCountByDimensionSeparatesModels(t *testing.T) {
	useMiniRedis(t)

	base := Dimensions{ChannelID: 44, UserID: 55, TokenID: 66}
	Track(context.Background(), Dimensions{
		ChannelID: base.ChannelID, UserID: base.UserID, TokenID: base.TokenID,
		Model: "model-a", Group: "default",
	}, NewRequestID())
	Track(context.Background(), Dimensions{
		ChannelID: base.ChannelID, UserID: base.UserID, TokenID: base.TokenID,
		Model: "model-b", Group: "vip",
	}, NewRequestID())
	Track(context.Background(), Dimensions{
		ChannelID: base.ChannelID, UserID: base.UserID, TokenID: base.TokenID,
		Model: "model-a", Group: "default",
	}, NewRequestID())

	breakdown, err := CountByDimension(DimensionChannel, base.ChannelID)
	require.NoError(t, err)
	assert.Equal(t, 2, breakdown["model-a|default"])
	assert.Equal(t, 1, breakdown["model-b|vip"])
}
