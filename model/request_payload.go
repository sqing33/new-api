package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm/clause"
)

// RequestPayload 记录单次上游 attempt 的三份请求上下文载荷。
//
// 独立成表以保证 logs 列表查询（Find(&logs) 全字段）不受大 TEXT 影响。
// 存主库 DB 而非 LOG_DB：日志库可能是 ClickHouse，其 DDL 是手写的、不做
// AutoMigrate，放在主库可天然绕开该问题。
type RequestPayload struct {
	Id int64 `json:"id" gorm:"primaryKey"`
	// RequestId 与 AttemptIndex 共同唯一：一次客户端请求可能因重试产生多个
	// attempt（重试上限 common.MaxRelayAttempts）。
	RequestId    string `json:"request_id" gorm:"type:varchar(64);not null;index:idx_rp_request_attempt,unique,priority:1;index:idx_rp_request_id"`
	AttemptIndex int    `json:"attempt_index" gorm:"not null;default:0;index:idx_rp_request_attempt,unique,priority:2"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;index;not null"`

	UserId      int    `json:"user_id" gorm:"index;default:0"`
	TokenId     int    `json:"token_id" gorm:"index;default:0"`
	TokenName   string `json:"token_name" gorm:"type:varchar(255);default:''"`
	ChannelId   int    `json:"channel_id" gorm:"index;default:0"`
	ModelName   string `json:"model_name" gorm:"type:varchar(255);index;default:''"`
	Group       string `json:"group" gorm:"type:varchar(255);default:''"`
	RelayFormat string `json:"relay_format" gorm:"type:varchar(32);default:''"`
	RequestPath string `json:"request_path" gorm:"type:varchar(255);default:''"`
	IsStream    bool   `json:"is_stream"`

	UpstreamRequestId string `json:"upstream_request_id" gorm:"type:varchar(128);default:''"`

	// SessionKey / SessionKeyKind 记录会话聚合键与其来源。
	// kind 取值见 pkg/relaycapture 的 SessionKeyKind* 常量。
	SessionKey     string `json:"session_key" gorm:"type:varchar(191);index;default:''"`
	SessionKeyKind string `json:"session_key_kind" gorm:"type:varchar(32);default:''"`
	// UpstreamResponseId 是上游返回的 response id，客户端下一轮的
	// previous_response_id 会回传它，用于 L2 链式聚合。
	UpstreamResponseId string `json:"upstream_response_id" gorm:"type:varchar(191);index;default:''"`

	// 三份载荷正文。json:"-" 保证列表与默认序列化绝不外泄，只在详情接口
	// 手工组装 DTO 返回。列类型用 text 且有应用层 MaxPayloadBytes 硬上限，
	// 保证不触及 MySQL TEXT 的 65535 字节上限。
	ClientRequestBody    string `json:"-" gorm:"type:text"`
	UpstreamRequestBody  string `json:"-" gorm:"type:text"`
	UpstreamResponseBody string `json:"-" gorm:"type:text"`

	// 截断与脱敏元信息，供 UI 明示「内容不完整」。
	ClientTruncated       bool `json:"client_truncated"`
	UpstreamReqTruncated  bool `json:"upstream_req_truncated"`
	UpstreamRespTruncated bool `json:"upstream_resp_truncated"`
	ClientBytes           int  `json:"client_bytes"`
	UpstreamReqBytes      int  `json:"upstream_req_bytes"`
	UpstreamRespBytes     int  `json:"upstream_resp_bytes"`
	Redacted              bool `json:"redacted"`

	// CaptureStatus: ok / partial（上游报错无响应体）/ failed
	CaptureStatus string `json:"capture_status" gorm:"type:varchar(16);default:'ok'"`
}

func (RequestPayload) TableName() string {
	return "request_payloads"
}

// requestPayloadBodyColumns 是三个正文列。列表与会话查询一律 Omit 掉它们，
// 保证任何轻量查询都不可能把正文带出来。
var requestPayloadBodyColumns = []string{
	"client_request_body",
	"upstream_request_body",
	"upstream_response_body",
}

// SaveRequestPayload upserts a payload row keyed by (request_id, attempt_index).
// It targets the main DB because the payload table never lives in the log DB.
func SaveRequestPayload(payload *RequestPayload) error {
	if payload == nil {
		return nil
	}
	if payload.CreatedAt == 0 {
		payload.CreatedAt = common.GetTimestamp()
	}
	return DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "request_id"}, {Name: "attempt_index"}},
		UpdateAll: true,
	}).Create(payload).Error
}

// GetRequestPayloadsByRequestId returns every attempt recorded for one client
// request, ordered by attempt index. Bodies are included, so callers must gate
// access by role.
func GetRequestPayloadsByRequestId(requestId string) ([]*RequestPayload, error) {
	if requestId == "" {
		return nil, nil
	}
	var payloads []*RequestPayload
	err := DB.Where("request_id = ?", requestId).Order("attempt_index asc").Find(&payloads).Error
	return payloads, err
}

// RequestPayloadSessionRow is one aggregated session in the session list. It
// intentionally carries no body content.
type RequestPayloadSessionRow struct {
	SessionKey     string `json:"session_key"`
	SessionKeyKind string `json:"session_key_kind"`
	StartAt        int64  `json:"start_at"`
	EndAt          int64  `json:"end_at"`
	RequestCount   int    `json:"request_count"`
	UserId         int    `json:"user_id"`
	TokenName      string `json:"token_name"`
	ModelName      string `json:"model_name"`
}

// payloadSessionSourceRow is one lightweight payload row used for session
// aggregation. Bodies are never selected.
type payloadSessionSourceRow struct {
	SessionKey     string
	SessionKeyKind string
	CreatedAt      int64
	UserId         int
	TokenName      string
	ModelName      string
}

// ListRequestPayloadSessions aggregates payloads into sessions. The time gap is
// applied after grouping by session key so the key never drifts over time.
// Bodies are never selected here.
func ListRequestPayloadSessions(userId int, modelName string, startTimestamp int64, endTimestamp int64, gapSeconds int64, startIdx int, num int) ([]*RequestPayloadSessionRow, int, error) {
	tx := DB.Model(&RequestPayload{}).
		Select("session_key, session_key_kind, created_at, user_id, token_name, model_name").
		Where("session_key <> ''")
	if userId != 0 {
		tx = tx.Where("user_id = ?", userId)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}

	var rows []payloadSessionSourceRow
	if err := tx.Order("session_key asc, created_at asc").Find(&rows).Error; err != nil {
		return nil, 0, err
	}

	sessions := splitPayloadSessions(rows, gapSeconds)
	total := len(sessions)
	if startIdx < 0 {
		startIdx = 0
	}
	if startIdx >= total {
		return []*RequestPayloadSessionRow{}, total, nil
	}
	end := total
	if num > 0 && startIdx+num < total {
		end = startIdx + num
	}
	return sessions[startIdx:end], total, nil
}

// splitPayloadSessions walks rows ordered by (session_key, created_at) and cuts
// a new session whenever the gap to the previous row exceeds gapSeconds. The
// result is reversed so the newest session comes first, matching the log list.
func splitPayloadSessions(rows []payloadSessionSourceRow, gapSeconds int64) []*RequestPayloadSessionRow {
	sessions := make([]*RequestPayloadSessionRow, 0, len(rows))
	var current *RequestPayloadSessionRow
	var lastAt int64
	for _, row := range rows {
		newSession := current == nil ||
			current.SessionKey != row.SessionKey ||
			(gapSeconds > 0 && row.CreatedAt-lastAt > gapSeconds)
		if newSession {
			current = &RequestPayloadSessionRow{
				SessionKey:     row.SessionKey,
				SessionKeyKind: row.SessionKeyKind,
				StartAt:        row.CreatedAt,
				EndAt:          row.CreatedAt,
				UserId:         row.UserId,
				TokenName:      row.TokenName,
				ModelName:      row.ModelName,
			}
			sessions = append(sessions, current)
		}
		current.EndAt = row.CreatedAt
		current.RequestCount++
		lastAt = row.CreatedAt
	}
	for i, j := 0, len(sessions)-1; i < j; i, j = i+1, j-1 {
		sessions[i], sessions[j] = sessions[j], sessions[i]
	}
	return sessions
}

// ListRequestPayloadsBySession returns the lightweight payload rows of one
// session (no bodies), ordered by time.
//
// 用 Omit 排除正文列而不是手写 Select 列表：手写列表必须处理 `group` 这个保留字
// 的方言引号差异（PG 双引号、MySQL/SQLite 反引号），而 Omit 由 GORM 按方言生成
// SQL，三库行为一致。
func ListRequestPayloadsBySession(sessionKey string, startAt int64, endAt int64) ([]*RequestPayload, error) {
	if sessionKey == "" {
		return nil, nil
	}
	tx := DB.Model(&RequestPayload{}).
		Omit(requestPayloadBodyColumns...).
		Where("session_key = ?", sessionKey)
	if startAt != 0 {
		tx = tx.Where("created_at >= ?", startAt)
	}
	if endAt != 0 {
		tx = tx.Where("created_at <= ?", endAt)
	}
	var payloads []*RequestPayload
	err := tx.Order("created_at asc, attempt_index asc").Find(&payloads).Error
	return payloads, err
}

// DeleteRequestPayloadsBefore removes at most limit payloads older than
// targetTimestamp and reports how many rows were deleted.
func DeleteRequestPayloadsBefore(targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 1000
	}
	result := DB.Where("created_at < ?", targetTimestamp).Limit(limit).Delete(&RequestPayload{})
	return result.RowsAffected, result.Error
}

// CountRequestPayloadsBefore reports how many payloads are older than target.
func CountRequestPayloadsBefore(targetTimestamp int64) (int64, error) {
	var total int64
	err := DB.Model(&RequestPayload{}).Where("created_at < ?", targetTimestamp).Count(&total).Error
	return total, err
}

// PurgeRequestPayloadsBefore loops batch deletes until nothing older remains.
func PurgeRequestPayloadsBefore(targetTimestamp int64) (int64, error) {
	var deleted int64
	for {
		n, err := DeleteRequestPayloadsBefore(targetTimestamp, 1000)
		if err != nil {
			return deleted, err
		}
		deleted += n
		if n < 1000 {
			return deleted, nil
		}
	}
}
