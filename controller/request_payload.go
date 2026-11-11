package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// requestPayloadDTO 是详情接口的返回结构。
//
// 正文只在这里手工组装：model.RequestPayload 的三个正文字段都标注了 json:"-"，
// 因此任何直接序列化模型的地方都不可能外泄正文。
type requestPayloadDTO struct {
	Id             int64  `json:"id"`
	RequestId      string `json:"request_id"`
	AttemptIndex   int    `json:"attempt_index"`
	CreatedAt      int64  `json:"created_at"`
	UserId         int    `json:"user_id"`
	TokenId        int    `json:"token_id"`
	TokenName      string `json:"token_name"`
	ChannelId      int    `json:"channel_id"`
	ModelName      string `json:"model_name"`
	Group          string `json:"group"`
	RelayFormat    string `json:"relay_format"`
	RequestPath    string `json:"request_path"`
	IsStream       bool   `json:"is_stream"`
	SessionKey     string `json:"session_key"`
	SessionKeyKind string `json:"session_key_kind"`

	UpstreamRequestId  string `json:"upstream_request_id"`
	UpstreamResponseId string `json:"upstream_response_id"`

	// 三份正文。仅详情接口返回。
	ClientRequestBody    string `json:"client_request_body"`
	UpstreamRequestBody  string `json:"upstream_request_body"`
	UpstreamResponseBody string `json:"upstream_response_body"`

	ClientTruncated       bool   `json:"client_truncated"`
	UpstreamReqTruncated  bool   `json:"upstream_req_truncated"`
	UpstreamRespTruncated bool   `json:"upstream_resp_truncated"`
	ClientBytes           int    `json:"client_bytes"`
	UpstreamReqBytes      int    `json:"upstream_req_bytes"`
	UpstreamRespBytes     int    `json:"upstream_resp_bytes"`
	Redacted              bool   `json:"redacted"`
	CaptureStatus         string `json:"capture_status"`
}

func toRequestPayloadDTO(payload *model.RequestPayload) requestPayloadDTO {
	return requestPayloadDTO{
		Id:                    payload.Id,
		RequestId:             payload.RequestId,
		AttemptIndex:          payload.AttemptIndex,
		CreatedAt:             payload.CreatedAt,
		UserId:                payload.UserId,
		TokenId:               payload.TokenId,
		TokenName:             payload.TokenName,
		ChannelId:             payload.ChannelId,
		ModelName:             payload.ModelName,
		Group:                 payload.Group,
		RelayFormat:           payload.RelayFormat,
		RequestPath:           payload.RequestPath,
		IsStream:              payload.IsStream,
		SessionKey:            payload.SessionKey,
		SessionKeyKind:        payload.SessionKeyKind,
		UpstreamRequestId:     payload.UpstreamRequestId,
		UpstreamResponseId:    payload.UpstreamResponseId,
		ClientRequestBody:     payload.ClientRequestBody,
		UpstreamRequestBody:   payload.UpstreamRequestBody,
		UpstreamResponseBody:  payload.UpstreamResponseBody,
		ClientTruncated:       payload.ClientTruncated,
		UpstreamReqTruncated:  payload.UpstreamReqTruncated,
		UpstreamRespTruncated: payload.UpstreamRespTruncated,
		ClientBytes:           payload.ClientBytes,
		UpstreamReqBytes:      payload.UpstreamReqBytes,
		UpstreamRespBytes:     payload.UpstreamRespBytes,
		Redacted:              payload.Redacted,
		CaptureStatus:         payload.CaptureStatus,
	}
}

// GetRequestPayloads 按 request_id 返回该客户端请求下所有 attempt 的载荷。
//
// 访问控制由路由上的 middleware.AdminAuth() 承担（Role >= 10），
// 服务端强制校验，不依赖前端隐藏入口。查询不接受客户端传入的 user_id 作为
// 放行条件——管理员本就可查看全部。
//
// 读取请求正文属于敏感操作，因此记录审计日志；审计事件只包含 request_id 与
// attempt 数，绝不包含正文本身。
func GetRequestPayloads(c *gin.Context) {
	requestId := strings.TrimSpace(c.Param("request_id"))
	if requestId == "" {
		common.ApiErrorMsg(c, "request_id is required")
		return
	}

	payloads, err := model.GetRequestPayloadsByRequestId(requestId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	items := make([]requestPayloadDTO, 0, len(payloads))
	for _, payload := range payloads {
		items = append(items, toRequestPayloadDTO(payload))
	}

	auditRequestPayloadRead(c, requestId, len(items))

	common.ApiSuccess(c, items)
}

// GetRequestPayloadSessions 返回会话聚合列表。
//
// 会话按 session_key 聚合，并按配置的时间窗口切分，因此同一 key 下间隔过久的
// 请求会分成多个会话。返回结构不含任何正文。
func GetRequestPayloadSessions(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	userId, _ := strconv.Atoi(c.Query("user_id"))
	modelName := c.Query("model_name")
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)

	gapSeconds := int64(operation_setting.GetPayloadCaptureSetting().SessionGapMinutes) * 60
	if gapSeconds < 0 {
		gapSeconds = 0
	}

	sessions, total, err := model.ListRequestPayloadSessions(
		userId, modelName, startTimestamp, endTimestamp, gapSeconds,
		pageInfo.GetStartIdx(), pageInfo.GetPageSize(),
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	pageInfo.SetTotal(total)
	pageInfo.SetItems(sessions)
	common.ApiSuccess(c, pageInfo)
}

// GetRequestPayloadSessionRequests 返回单个会话内的请求列表（不含正文）。
func GetRequestPayloadSessionRequests(c *gin.Context) {
	sessionKey := strings.TrimSpace(c.Param("session_key"))
	if sessionKey == "" {
		common.ApiErrorMsg(c, "session_key is required")
		return
	}
	startAt, _ := strconv.ParseInt(c.Query("start_at"), 10, 64)
	endAt, _ := strconv.ParseInt(c.Query("end_at"), 10, 64)

	payloads, err := model.ListRequestPayloadsBySession(sessionKey, startAt, endAt)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// model 层的 Select 已排除三个正文列，这里再兜一层：即使将来 Select 变化，
	// 也不会把正文带进会话列表。
	items := make([]requestPayloadDTO, 0, len(payloads))
	for _, payload := range payloads {
		dto := toRequestPayloadDTO(payload)
		dto.ClientRequestBody = ""
		dto.UpstreamRequestBody = ""
		dto.UpstreamResponseBody = ""
		items = append(items, dto)
	}
	common.ApiSuccess(c, items)
}

// DeleteRequestPayloads 按时间清理历史载荷。仅超级管理员可调用（路由上挂
// middleware.RootAuth()），因为正文包含用户对话内容。
func DeleteRequestPayloads(c *gin.Context) {
	targetTimestamp, _ := strconv.ParseInt(c.Query("target_timestamp"), 10, 64)
	if targetTimestamp == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "target timestamp is required",
		})
		return
	}

	deleted, err := model.PurgeRequestPayloadsBefore(targetTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	model.RecordOperationAuditLog(
		c.GetInt("id"), c.GetInt("role"),
		"delete request payloads before "+strconv.FormatInt(targetTimestamp, 10),
		c.ClientIP(),
		"request_payload.delete",
		map[string]any{"target_timestamp": targetTimestamp, "deleted": deleted},
		&model.AuditAdminInfo{
			AdminID:       c.GetInt("id"),
			AdminUsername: c.GetString("username"),
			AdminRole:     c.GetInt("role"),
		},
		nil,
		c,
	)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    deleted,
	})
}

// auditRequestPayloadRead 记录「谁查看了哪个请求的载荷」。
//
// 审计事件只包含 request_id 与 attempt 数，不含任何正文片段。
func auditRequestPayloadRead(c *gin.Context, requestId string, attempts int) {
	model.RecordOperationAuditLog(
		c.GetInt("id"), c.GetInt("role"),
		"view request payload "+requestId,
		c.ClientIP(),
		"request_payload.view",
		map[string]any{"request_id": requestId, "attempts": attempts},
		&model.AuditAdminInfo{
			AdminID:       c.GetInt("id"),
			AdminUsername: c.GetString("username"),
			AdminRole:     c.GetInt("role"),
		},
		nil,
		c,
	)
}
