package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// DefaultMaxPayloadBytes 是单份载荷正文的存储上限（字节）。
//
// 48KB 的取值来自 MySQL TEXT 的 65535 字节硬上限：列类型在三库统一用 text，
// 留出 UTF-8 编码与行开销余量后 48KB 可确保任何一份正文都不会触及该上限。
// 需要更大的正文时应先补 mediumtext 的三库迁移，而不是直接抬高此值。
const DefaultMaxPayloadBytes = 49152

// PayloadCaptureSetting 控制请求上下文载荷的采集范围。
//
// 全部默认关闭：请求正文包含用户对话内容与潜在凭据，且每次请求最多占用
// 3 * MaxPayloadBytes 的存储。上游同类实现（LiteLLM 的
// store_prompts_in_spend_logs、sub2api 的 prompt-audit）同样默认关闭。
type PayloadCaptureSetting struct {
	// Enabled 是总开关。为 false 时采集链路只做一次判断即返回，
	// 不读取 body 副本、不分配缓冲。
	Enabled bool `json:"enabled"`
	// CaptureClientRequest 采集客户端原始请求体。
	CaptureClientRequest bool `json:"capture_client_request"`
	// CaptureUpstreamRequest 采集转换后真正发往上游的请求体。
	CaptureUpstreamRequest bool `json:"capture_upstream_request"`
	// CaptureUpstreamResponse 采集上游响应内容。
	CaptureUpstreamResponse bool `json:"capture_upstream_response"`
	// CaptureRawUpstreamResponse 为 true 时改用 io.TeeReader 采集上游原始字节，
	// 而不是默认的「转发给客户端的帧」。已知限制：会替换 resp.Body 的渠道
	// （minimax）在此模式下采不到响应体。
	CaptureRawUpstreamResponse bool `json:"capture_raw_upstream_response"`
	// CaptureBinary 为 false 时，多模态/base64/二进制内容被替换为占位符，
	// 只保留文本部分，避免图片与音频撑爆存储。
	CaptureBinary bool `json:"capture_binary"`
	// MaxPayloadBytes 是单份正文的存储上限，超出即截断并标记。
	MaxPayloadBytes int `json:"max_payload_bytes"`
	// RetentionDays 是正文保留天数，0 表示不自动清理。
	RetentionDays int `json:"retention_days"`
	// SessionGapMinutes 是启发式会话分组的时间窗口：超过该间隔无新请求即切分新会话。
	SessionGapMinutes int `json:"session_gap_minutes"`
	// DisabledTokenIds 允许按令牌关闭采集。
	DisabledTokenIds []int `json:"disabled_token_ids"`
}

var payloadCaptureSetting = PayloadCaptureSetting{
	Enabled:                    false,
	CaptureClientRequest:       true,
	CaptureUpstreamRequest:     true,
	CaptureUpstreamResponse:    true,
	CaptureRawUpstreamResponse: false,
	CaptureBinary:              false,
	MaxPayloadBytes:            DefaultMaxPayloadBytes,
	RetentionDays:              7,
	SessionGapMinutes:          30,
	DisabledTokenIds:           nil,
}

func init() {
	config.GlobalConfig.Register("payload_capture_setting", &payloadCaptureSetting)
}

func GetPayloadCaptureSetting() *PayloadCaptureSetting {
	return &payloadCaptureSetting
}

// MaxPayloadBytesOrDefault 返回生效的正文上限，配置为非正值时回退默认值。
func (s *PayloadCaptureSetting) MaxPayloadBytesOrDefault() int {
	if s == nil || s.MaxPayloadBytes <= 0 {
		return DefaultMaxPayloadBytes
	}
	return s.MaxPayloadBytes
}

// IsTokenDisabled 判断某令牌是否被显式排除在采集之外。
func (s *PayloadCaptureSetting) IsTokenDisabled(tokenId int) bool {
	if s == nil || tokenId <= 0 {
		return false
	}
	for _, id := range s.DisabledTokenIds {
		if id == tokenId {
			return true
		}
	}
	return false
}
