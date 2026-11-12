package perfmetrics

import "sync/atomic"

type Store interface {
	Record(sample Sample)
	Query(params QueryParams) (QueryResult, error)
}

type Sample struct {
	Model        string
	Group        string
	ChannelName  string
	TokenId      int
	TokenName    string
	LatencyMs    int64
	TtftMs       int64
	HasTtft      bool
	Success      bool
	OutputTokens int64
	GenerationMs int64
}

const UnknownChannelName = "unknown"

type QueryParams struct {
	Model string
	Group string
	Hours int
	// AllowedGroups restricts both the per-group results and the model summary;
	// nil allows every group.
	AllowedGroups []string
}

// Summary is the request-weighted aggregate over every bucket in the window.
type Summary struct {
	AvgLatencyMs int64   `json:"avg_latency_ms"`
	SuccessRate  float64 `json:"success_rate"`
	AvgTps       float64 `json:"avg_tps"`
}

type BucketPoint struct {
	Ts             int64   `json:"ts"`
	AvgTtftMs      int64   `json:"avg_ttft_ms"`
	AvgLatencyMs   int64   `json:"avg_latency_ms"`
	SuccessRate    float64 `json:"success_rate"`
	AvgTps         float64 `json:"avg_tps"`
	MaxConcurrency int     `json:"max_concurrency"`
	AvgConcurrency float64 `json:"avg_concurrency"`
}

type GroupResult struct {
	Group          string        `json:"group"`
	AvgTtftMs      int64         `json:"avg_ttft_ms"`
	AvgLatencyMs   int64         `json:"avg_latency_ms"`
	SuccessRate    float64       `json:"success_rate"`
	AvgTps         float64       `json:"avg_tps"`
	MaxConcurrency int           `json:"max_concurrency"`
	AvgConcurrency float64       `json:"avg_concurrency"`
	Series         []BucketPoint `json:"series"`
}

type ChannelResult struct {
	Channel        string        `json:"channel"`
	AvgTtftMs      int64         `json:"avg_ttft_ms"`
	AvgLatencyMs   int64         `json:"avg_latency_ms"`
	SuccessRate    float64       `json:"success_rate"`
	AvgTps         float64       `json:"avg_tps"`
	MaxConcurrency int           `json:"max_concurrency"`
	AvgConcurrency float64       `json:"avg_concurrency"`
	Series         []BucketPoint `json:"series"`
}

// TokenResult 是按令牌维度聚合的指标，与 ChannelResult 同构。
type TokenResult struct {
	TokenId   int    `json:"token_id"`
	TokenName string `json:"token_name"`
	// OwnerName 是令牌归属用户的用户名。管理员看全部用户的令牌时才有值，
	// 用于区分「不同用户的同名令牌」；普通用户只看自己的令牌，此字段为空。
	OwnerName      string        `json:"owner_name,omitempty"`
	AvgTtftMs      int64         `json:"avg_ttft_ms"`
	AvgLatencyMs   int64         `json:"avg_latency_ms"`
	SuccessRate    float64       `json:"success_rate"`
	AvgTps         float64       `json:"avg_tps"`
	MaxConcurrency int           `json:"max_concurrency"`
	AvgConcurrency float64       `json:"avg_concurrency"`
	Series         []BucketPoint `json:"series"`
}

type QueryResult struct {
	ModelName    string          `json:"model_name"`
	SeriesSchema string          `json:"series_schema"`
	Summary      *Summary        `json:"summary"`
	Series       []BucketPoint   `json:"series"`
	WindowStart  int64           `json:"window_start"`
	WindowEnd    int64           `json:"window_end"`
	Groups       []GroupResult   `json:"groups"`
	Channels     []ChannelResult `json:"channels"`
	Tokens       []TokenResult   `json:"tokens"`
}

type SuccessRatePoint struct {
	Ts          int64   `json:"ts"`
	SuccessRate float64 `json:"success_rate"`
}

// ConcurrencyPoint 是并发采样序列上的一个点。
type ConcurrencyPoint struct {
	Ts             int64   `json:"ts"`
	MaxConcurrency int     `json:"max_concurrency"`
	AvgConcurrency float64 `json:"avg_concurrency"`
}

type ModelSummary struct {
	ModelName               string             `json:"model_name"`
	AvgLatencyMs            int64              `json:"avg_latency_ms"`
	SuccessRate             float64            `json:"success_rate"`
	AvgTps                  float64            `json:"avg_tps"`
	RecentSuccessSeries     []SuccessRatePoint `json:"recent_success_series,omitempty"`
	RecentConcurrencySeries []ConcurrencyPoint `json:"recent_concurrency_series,omitempty"`
	MaxConcurrency          int                `json:"max_concurrency"`
	AvgConcurrency          float64            `json:"avg_concurrency"`
	RequestCount            int64              `json:"-"`
}

type SummaryAllResult struct {
	Summary     *Summary       `json:"summary"`
	WindowStart int64          `json:"window_start"`
	WindowEnd   int64          `json:"window_end"`
	Models      []ModelSummary `json:"models"`
	// RecentSuccessSeries contains up to 24 nonempty hours from the last 7 days,
	// including requested models with no traffic in the summary window.
	RecentSuccessSeries map[string][]SuccessRatePoint `json:"recent_success_series,omitempty"`
}

type bucketKey struct {
	model     string
	group     string
	channel   string
	tokenId   int
	tokenName string
	bucketTs  int64
}

type counters struct {
	requestCount   int64
	successCount   int64
	totalLatencyMs int64
	ttftSumMs      int64
	ttftCount      int64
	outputTokens   int64
	generationMs   int64
}

type atomicBucket struct {
	requestCount   atomic.Int64
	successCount   atomic.Int64
	totalLatencyMs atomic.Int64
	ttftSumMs      atomic.Int64
	ttftCount      atomic.Int64
	outputTokens   atomic.Int64
	generationMs   atomic.Int64
}

func (b *atomicBucket) add(sample Sample) {
	b.requestCount.Add(1)
	if sample.Success {
		b.successCount.Add(1)
	}
	if sample.LatencyMs > 0 {
		b.totalLatencyMs.Add(sample.LatencyMs)
	}
	if sample.HasTtft && sample.TtftMs >= 0 {
		b.ttftSumMs.Add(sample.TtftMs)
		b.ttftCount.Add(1)
	}
	if sample.OutputTokens > 0 && sample.GenerationMs > 0 {
		b.outputTokens.Add(sample.OutputTokens)
		b.generationMs.Add(sample.GenerationMs)
	}
}

func (b *atomicBucket) snapshot() counters {
	return counters{
		requestCount:   b.requestCount.Load(),
		successCount:   b.successCount.Load(),
		totalLatencyMs: b.totalLatencyMs.Load(),
		ttftSumMs:      b.ttftSumMs.Load(),
		ttftCount:      b.ttftCount.Load(),
		outputTokens:   b.outputTokens.Load(),
		generationMs:   b.generationMs.Load(),
	}
}

func (b *atomicBucket) drain() counters {
	return counters{
		requestCount:   b.requestCount.Swap(0),
		successCount:   b.successCount.Swap(0),
		totalLatencyMs: b.totalLatencyMs.Swap(0),
		ttftSumMs:      b.ttftSumMs.Swap(0),
		ttftCount:      b.ttftCount.Swap(0),
		outputTokens:   b.outputTokens.Swap(0),
		generationMs:   b.generationMs.Swap(0),
	}
}

func (b *atomicBucket) addCounters(c counters) {
	if c.requestCount != 0 {
		b.requestCount.Add(c.requestCount)
	}
	if c.successCount != 0 {
		b.successCount.Add(c.successCount)
	}
	if c.totalLatencyMs != 0 {
		b.totalLatencyMs.Add(c.totalLatencyMs)
	}
	if c.ttftSumMs != 0 {
		b.ttftSumMs.Add(c.ttftSumMs)
	}
	if c.ttftCount != 0 {
		b.ttftCount.Add(c.ttftCount)
	}
	if c.outputTokens != 0 {
		b.outputTokens.Add(c.outputTokens)
	}
	if c.generationMs != 0 {
		b.generationMs.Add(c.generationMs)
	}
}
