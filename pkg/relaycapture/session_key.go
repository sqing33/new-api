package relaycapture

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/tidwall/gjson"
)

// 会话键来源（SessionKeyKind）。取值按可靠性从高到低排列，
// UI 必须据此提示置信度：heuristic 为启发式分组，可能不准确。
const (
	// SessionKeyKindExplicit 表示客户端显式声明了会话/终端用户标识。
	SessionKeyKindExplicit = "explicit"
	// SessionKeyKindResponseChain 表示 Responses API 的 previous_response_id 链。
	SessionKeyKindResponseChain = "response_chain"
	// SessionKeyKindHeuristic 表示按令牌+模型+首条 system 消息指纹的兜底分组。
	SessionKeyKindHeuristic = "heuristic"
	// SessionKeyKindEmpty 表示无法分组，只能按单条请求查看。
	SessionKeyKindEmpty = "empty"
)

// heuristicFingerprintBytes 是 L3 启发式指纹取用的首条 system 消息字节数。
// 取值过小会误合并不同会话，过大会让同一会话因尾部差异分裂；1024 是折中值。
const heuristicFingerprintBytes = 1024

// SessionKeyInput 汇总推导会话键所需的输入。
//
// 之所以由调用方传入解析后的字段而不是整个请求对象，是因为各协议的 DTO
// 结构不同，而这里只需要这几个跨协议通用的线索。
type SessionKeyInput struct {
	// TokenId 与 ModelName 参与 L3 指纹构造。
	TokenId   int
	ModelName string
	// PromptCacheKey 对应 OpenAI Chat / Responses 的 prompt_cache_key。
	PromptCacheKey string
	// User 对应 OpenAI Chat 的 user 字段原始 JSON。
	User []byte
	// Metadata 对应请求的 metadata 字段原始 JSON（Claude 的 metadata.user_id 在此）。
	Metadata []byte
	// PreviousResponseID 对应 Responses API 的 previous_response_id。
	PreviousResponseID string
	// SystemPrompt 是首条 system 消息文本，用于 L3 指纹。
	SystemPrompt string
}

// SessionKey 是推导结果。Key 为空表示无法分组。
type SessionKey struct {
	Key  string
	Kind string
}

// DeriveSessionKey 按三级优先级推导会话键，取第一个命中的：
//
//	L1 explicit       客户端显式声明（prompt_cache_key → metadata.user_id → user）
//	L2 response_chain Responses API 的 previous_response_id
//	L3 heuristic      令牌 + 模型 + 首条 system 消息指纹
//
// 全部落空时返回空键，调用方应把它当作「只能按单条请求查看」。
//
// 时间窗口不在此处参与：窗口在查询期按 created_at 切分，避免键随时间漂移。
func DeriveSessionKey(input SessionKeyInput) SessionKey {
	if value := strings.TrimSpace(input.PromptCacheKey); value != "" {
		return SessionKey{Key: buildSessionKey("pck", value), Kind: SessionKeyKindExplicit}
	}
	if value := metadataUserID(input.Metadata); value != "" {
		return SessionKey{Key: buildSessionKey("meta", value), Kind: SessionKeyKindExplicit}
	}
	if value := jsonStringField(input.User); value != "" {
		return SessionKey{Key: buildSessionKey("user", value), Kind: SessionKeyKindExplicit}
	}

	if value := strings.TrimSpace(input.PreviousResponseID); value != "" {
		return SessionKey{Key: buildSessionKey("prev", value), Kind: SessionKeyKindResponseChain}
	}

	if fingerprint := heuristicFingerprint(input); fingerprint != "" {
		return SessionKey{Key: buildSessionKey("heur", fingerprint), Kind: SessionKeyKindHeuristic}
	}

	return SessionKey{Kind: SessionKeyKindEmpty}
}

// buildSessionKey 以固定前缀加内容的 sha256 构造定长键，避免把客户端原始值
// 直接写进索引列（既控制长度，也不泄露用户标识）。
func buildSessionKey(prefix string, value string) string {
	sum := sha256.Sum256([]byte(prefix + "\x00" + value))
	return prefix + "-" + hex.EncodeToString(sum[:])
}

// heuristicFingerprint 构造 L3 指纹。令牌与模型用于隔离不同调用方与不同模型，
// 首条 system 消息用于区分同一令牌下的不同对话主题。
func heuristicFingerprint(input SessionKeyInput) string {
	system := input.SystemPrompt
	if len(system) > heuristicFingerprintBytes {
		system = system[:heuristicFingerprintBytes]
	}
	if input.TokenId == 0 && input.ModelName == "" && system == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{
		strconvItoa(input.TokenId),
		input.ModelName,
		system,
	}, "\x00")))
	return hex.EncodeToString(sum[:])
}

// metadataUserID 从 metadata 原始 JSON 里取 user_id。
// Claude Messages 用的就是 metadata.user_id。
func metadataUserID(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	value := gjson.GetBytes(raw, "user_id")
	if !value.Exists() || value.Type != gjson.String {
		return ""
	}
	return strings.TrimSpace(value.String())
}

// jsonStringField 读取一个可能是 JSON 字符串也可能不是的字段，
// 仅在它确实是字符串时返回值。
func jsonStringField(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	parsed := gjson.ParseBytes(raw)
	if parsed.Type != gjson.String {
		return ""
	}
	return strings.TrimSpace(parsed.String())
}

// SessionKeyInputFromOpenAIChat 从 OpenAI Chat 请求提取会话线索。
func SessionKeyInputFromOpenAIChat(tokenId int, modelName string, req *dto.GeneralOpenAIRequest) SessionKeyInput {
	if req == nil {
		return SessionKeyInput{TokenId: tokenId, ModelName: modelName}
	}
	return SessionKeyInput{
		TokenId:        tokenId,
		ModelName:      modelName,
		PromptCacheKey: req.PromptCacheKey,
		User:           req.User,
		Metadata:       req.Metadata,
		SystemPrompt:   firstSystemPromptFromChat(req.Messages),
	}
}

// SessionKeyInputFromClaude 从 Claude Messages 请求提取会话线索。
func SessionKeyInputFromClaude(tokenId int, modelName string, req *dto.ClaudeRequest) SessionKeyInput {
	if req == nil {
		return SessionKeyInput{TokenId: tokenId, ModelName: modelName}
	}
	return SessionKeyInput{
		TokenId:      tokenId,
		ModelName:    modelName,
		Metadata:     req.Metadata,
		SystemPrompt: claudeSystemPrompt(req.System),
	}
}

// SessionKeyInputFromResponses 从 Responses 请求提取会话线索。
func SessionKeyInputFromResponses(tokenId int, modelName string, req *dto.OpenAIResponsesRequest) SessionKeyInput {
	if req == nil {
		return SessionKeyInput{TokenId: tokenId, ModelName: modelName}
	}
	return SessionKeyInput{
		TokenId:            tokenId,
		ModelName:          modelName,
		PromptCacheKey:     jsonStringField(req.PromptCacheKey),
		User:               req.User,
		Metadata:           req.Metadata,
		PreviousResponseID: req.PreviousResponseID,
		SystemPrompt:       jsonTextField(req.Instructions),
	}
}

// SessionKeyInputForRequest 按具体请求类型分派到对应的提取函数。
//
// 各协议 DTO 结构不同，但会话线索只有这几个跨协议通用的字段；未识别的类型
// 退化为只用令牌与模型的 L3 指纹，不会 panic。
func SessionKeyInputForRequest(tokenId int, modelName string, request dto.Request) SessionKeyInput {
	switch typed := request.(type) {
	case *dto.GeneralOpenAIRequest:
		return SessionKeyInputFromOpenAIChat(tokenId, modelName, typed)
	case *dto.ClaudeRequest:
		return SessionKeyInputFromClaude(tokenId, modelName, typed)
	case *dto.OpenAIResponsesRequest:
		return SessionKeyInputFromResponses(tokenId, modelName, typed)
	case nil:
		return SessionKeyInput{TokenId: tokenId, ModelName: modelName}
	default:
		return SessionKeyInput{TokenId: tokenId, ModelName: modelName}
	}
}

// firstSystemPromptFromChat 取第一条 role=system 消息的文本内容。
// Content 可能是字符串，也可能是内容块数组，这里只取纯文本部分用于指纹。
func firstSystemPromptFromChat(messages []dto.Message) string {
	for _, message := range messages {
		if !strings.EqualFold(message.Role, "system") {
			continue
		}
		return textFromAny(message.Content)
	}
	return ""
}

// claudeSystemPrompt 取 Claude 请求的 system 文本。system 可能是字符串，
// 也可能是内容块数组。
func claudeSystemPrompt(system any) string {
	return textFromAny(system)
}

// textFromAny 从可能是字符串、内容块数组或 RawMessage 的值里提取纯文本。
func textFromAny(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case []byte:
		return jsonTextField(typed)
	default:
		encoded, err := common.Marshal(value)
		if err != nil {
			return ""
		}
		return jsonTextField(encoded)
	}
}

// jsonTextField 从原始 JSON 里提取可读文本：JSON 字符串取其值，
// 数组则拼接各元素的 text 字段，其他类型取原始表示。
func jsonTextField(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	parsed := gjson.ParseBytes(raw)
	switch {
	case parsed.Type == gjson.String:
		return parsed.String()
	case parsed.IsArray():
		var builder strings.Builder
		parsed.ForEach(func(_, item gjson.Result) bool {
			if item.Type == gjson.String {
				builder.WriteString(item.String())
				return true
			}
			if text := item.Get("text"); text.Exists() && text.Type == gjson.String {
				builder.WriteString(text.String())
			}
			return true
		})
		return builder.String()
	default:
		return parsed.Raw
	}
}

// strconvItoa 避免为一处转换额外引入 strconv 之外的依赖分歧。
func strconvItoa(value int) string {
	return strconv.Itoa(value)
}
