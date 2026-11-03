// Package concurrency tracks how many relay requests are in flight for each
// channel, user and API token. It is a stats-only observation layer: it never
// rejects, queues or delays a request. Every failure mode is silent so that a
// Redis outage degrades the numbers instead of the gateway.
package concurrency

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/go-redis/redis/v8"
)

// Dimension selects which namespace a batch read or write applies to.
type Dimension string

const (
	DimensionChannel Dimension = "channel"
	DimensionUser    Dimension = "user"
	DimensionToken   Dimension = "token"
)

const (
	// keyNamespace is versioned so a future layout change cannot collide with
	// slots written by an older build.
	keyNamespace = "concurrency:v1"

	// SlotTTLSeconds bounds how long a leaked slot survives. Normal completion
	// removes the member exactly; this only covers a hard process kill.
	SlotTTLSeconds = 30 * 60

	// trackTimeout and releaseTimeout keep the tracker off the request's
	// critical path. Release runs on a detached context, so it needs its own.
	trackTimeout   = 2 * time.Second
	releaseTimeout = 2 * time.Second

	// readTimeout bounds the admin list query.
	readTimeout = 3 * time.Second
)

// trackScriptSrc records one in-flight request without applying any limit.
//
// It trims expired members first so a crashed process cannot inflate the count
// forever, then adds the request and refreshes the key TTL. redis.call('TIME')
// keeps every instance on the same clock, which matters because the score *is*
// the expiry reference.
const trackScriptSrc = `
	-- Redis 3.2-4.x compat: opt into effects replication so redis.call('TIME')
	-- replicates correctly. No-op on Redis 5.0+ (effects replication is default).
	redis.replicate_commands()
	local key = KEYS[1]
	local ttl = tonumber(ARGV[1])
	local requestID = ARGV[2]

	local now = tonumber(redis.call('TIME')[1])
	local expireBefore = now - ttl

	redis.call('ZREMRANGEBYSCORE', key, '-inf', expireBefore)
	redis.call('ZADD', key, now, requestID)
	redis.call('EXPIRE', key, ttl)
	return 1
`

// trackScript is only used for its precomputed SHA.
var trackScript = redis.NewScript(trackScriptSrc)

// Dimensions carries the entity ids a single request belongs to. A zero or
// negative id means "not applicable" and that dimension is skipped.
//
// Model and Group are not entity ids: they are carried inside the sorted-set
// member so that concurrency can be broken down per model/group later, which
// the performance dashboard needs. They are optional.
type Dimensions struct {
	ChannelID int
	UserID    int
	TokenID   int
	Model     string
	Group     string
}

// memberSeparator joins the request id with the model/group breakdown inside a
// sorted-set member. It must not appear in any of the joined values; model and
// group names come from admin configuration and are validated elsewhere.
const memberSeparator = "\x1f"

// member builds the sorted-set member for one in-flight request. Track and
// Release MUST both go through this function: Release removes by exact member
// value, so any divergence here would leak slots until the TTL expires.
func (d Dimensions) member(requestID string) string {
	if d.Model == "" && d.Group == "" {
		return requestID
	}
	return requestID + memberSeparator + d.Model + memberSeparator + d.Group
}

// keys returns the Redis keys for every populated dimension.
func (d Dimensions) keys() []string {
	keys := make([]string, 0, 3)
	if d.ChannelID > 0 {
		keys = append(keys, slotKey(DimensionChannel, d.ChannelID))
	}
	if d.UserID > 0 {
		keys = append(keys, slotKey(DimensionUser, d.UserID))
	}
	if d.TokenID > 0 {
		keys = append(keys, slotKey(DimensionToken, d.TokenID))
	}
	return keys
}

func slotKey(dim Dimension, id int) string {
	return fmt.Sprintf("%s:%s:%d", keyNamespace, dim, id)
}

var (
	requestIDPrefix  = initRequestIDPrefix()
	requestIDCounter atomic.Uint64
)

func initRequestIDPrefix() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err == nil {
		return "r" + strconv.FormatUint(binary.BigEndian.Uint64(b), 36)
	}
	fallback := uint64(time.Now().UnixNano()) ^ (uint64(os.Getpid()) << 16)
	return "r" + strconv.FormatUint(fallback, 36)
}

// NewRequestID returns a process-unique id for one in-flight request. The same
// id is reused across all three dimensions so a leaked slot can be traced back
// to the process that created it.
func NewRequestID() string {
	return requestIDPrefix + "-" + strconv.FormatUint(requestIDCounter.Add(1), 36)
}

// enabled reports whether tracking should run at all.
func enabled() bool {
	return common.RedisEnabled && common.RDB != nil
}

// Track records one in-flight request for every populated dimension. All
// dimensions go out in a single pipeline, so the cost stays one network round
// trip regardless of how many dimensions are active.
//
// Errors are logged and swallowed: observation must never fail a request.
func Track(ctx context.Context, dims Dimensions, requestID string) {
	if !enabled() || requestID == "" {
		return
	}
	keys := dims.keys()
	if len(keys) == 0 {
		return
	}

	baseCtx := context.Background()
	if ctx != nil {
		// Detach from the request context so a client disconnect mid-flight does
		// not cancel the bookkeeping write.
		baseCtx = context.WithoutCancel(ctx)
	}
	trackCtx, cancel := context.WithTimeout(baseCtx, trackTimeout)
	defer cancel()

	if err := runTrackPipeline(trackCtx, keys, requestID, dims.member(requestID)); err != nil {
		common.SysError(fmt.Sprintf("concurrency: track failed (req=%s): %v", requestID, err))
	}
}

// runTrackPipeline issues one EVALSHA per dimension inside a single pipeline.
//
// Script.Run cannot be used here: inside a Pipeline the returned Cmd carries no
// error until Exec, so Run's NOSCRIPT fallback to EVAL would never fire. The
// script SHA is therefore loaded up front and the whole pipeline is retried once
// with EVAL after a NOSCRIPT, which happens when Redis was flushed or restarted.
func runTrackPipeline(ctx context.Context, keys []string, requestID string, member string) error {
	err := execTrackPipeline(ctx, keys, requestID, member, false)
	if err == nil || !isNoScriptError(err) {
		return err
	}
	// Reload the script and retry once with EVAL so a single flush does not
	// silently drop the counters for this request.
	return execTrackPipeline(ctx, keys, requestID, member, true)
}

func execTrackPipeline(ctx context.Context, keys []string, requestID string, member string, useEval bool) error {
	pipe := common.RDB.Pipeline()
	for _, key := range keys {
		if useEval {
			pipe.Eval(ctx, trackScriptSrc, []string{key}, SlotTTLSeconds, member)
			continue
		}
		pipe.EvalSha(ctx, trackScript.Hash(), []string{key}, SlotTTLSeconds, member)
	}
	_, err := pipe.Exec(ctx)
	if err == redis.Nil {
		return nil
	}
	return err
}

func isNoScriptError(err error) bool {
	return err != nil && strings.HasPrefix(err.Error(), "NOSCRIPT ")
}

// Release removes one in-flight request from every populated dimension. The
// returned function is idempotent, so callers can both defer it and use it as a
// cancellation safety net.
func Release(dims Dimensions, requestID string) func() {
	if requestID == "" {
		return func() {}
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			if !enabled() {
				return
			}
			keys := dims.keys()
			if len(keys) == 0 {
				return
			}
			releaseCtx, cancel := context.WithTimeout(context.Background(), releaseTimeout)
			defer cancel()

			pipe := common.RDB.Pipeline()
			member := dims.member(requestID)
			for _, key := range keys {
				pipe.ZRem(releaseCtx, key, member)
			}
			if _, err := pipe.Exec(releaseCtx); err != nil && err != redis.Nil {
				// The slot self-heals once the key TTL expires.
				common.SysError(fmt.Sprintf("concurrency: release failed (req=%s): %v", requestID, err))
			}
		})
	}
}

// CountByDimension breaks the live concurrency of each id down by the
// "model|group" pair recorded in the sorted-set member. Ids with no live
// request are absent from the result.
//
// It returns a map keyed by "model|group" for one id at a time because the
// caller (the performance sampler) needs the per-id breakdown to attribute
// concurrency to a channel row. Concurrency is normally in the tens, so
// reading every member is cheap.
func CountByDimension(dim Dimension, id int) (map[string]int, error) {
	result := make(map[string]int)
	if !enabled() || id <= 0 {
		return result, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
	defer cancel()

	key := slotKey(dim, id)
	now, err := common.RDB.Time(ctx).Result()
	if err != nil {
		return nil, err
	}
	cutoff := strconv.FormatInt(now.Unix()-SlotTTLSeconds, 10)
	if err := common.RDB.ZRemRangeByScore(ctx, key, "-inf", cutoff).Err(); err != nil && err != redis.Nil {
		return nil, err
	}

	members, err := common.RDB.ZRange(ctx, key, 0, -1).Result()
	if err != nil && err != redis.Nil {
		return nil, err
	}
	for _, member := range members {
		parts := strings.SplitN(member, memberSeparator, 3)
		if len(parts) < 3 {
			continue
		}
		bucket := parts[1] + "|" + parts[2]
		result[bucket]++
	}
	return result, nil
}

// LiveIDs lists the ids that currently have at least one in-flight request for
// the given dimension. It scans the key namespace, so it is meant for the
// periodic sampler rather than a request path.
func LiveIDs(dim Dimension) ([]int, error) {
	if !enabled() {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
	defer cancel()

	prefix := fmt.Sprintf("%s:%s:", keyNamespace, dim)
	ids := make([]int, 0)
	var cursor uint64
	for {
		keys, next, err := common.RDB.Scan(ctx, cursor, prefix+"*", 200).Result()
		if err != nil {
			return nil, err
		}
		for _, key := range keys {
			raw := strings.TrimPrefix(key, prefix)
			if id, convErr := strconv.Atoi(raw); convErr == nil && id > 0 {
				ids = append(ids, id)
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return ids, nil
}

// BatchCount returns the current in-flight request count for each id. Expired
// members are trimmed as part of the read so a crashed process does not inflate
// the number until the key TTL expires.
//
// Missing ids and any Redis failure yield zero, keeping the admin list usable.
func BatchCount(dim Dimension, ids []int) map[int]int {
	result := make(map[int]int, len(ids))
	for _, id := range ids {
		result[id] = 0
	}
	if !enabled() || len(ids) == 0 {
		return result
	}

	ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
	defer cancel()

	now, err := common.RDB.Time(ctx).Result()
	if err != nil {
		common.SysError(fmt.Sprintf("concurrency: redis TIME failed: %v", err))
		return result
	}
	cutoff := strconv.FormatInt(now.Unix()-SlotTTLSeconds, 10)

	type countCmd struct {
		id  int
		cmd *redis.IntCmd
	}
	cmds := make([]countCmd, 0, len(ids))
	pipe := common.RDB.Pipeline()
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		key := slotKey(dim, id)
		pipe.ZRemRangeByScore(ctx, key, "-inf", cutoff)
		cmds = append(cmds, countCmd{id: id, cmd: pipe.ZCard(ctx, key)})
	}
	if len(cmds) == 0 {
		return result
	}
	if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
		common.SysError(fmt.Sprintf("concurrency: batch count failed: %v", err))
		return result
	}
	for _, c := range cmds {
		result[c.id] = int(c.cmd.Val())
	}
	return result
}
