package dto

type ChannelSettings struct {
	ForceFormat            bool   `json:"force_format,omitempty"`
	ThinkingToContent      bool   `json:"thinking_to_content,omitempty"`
	Proxy                  string `json:"proxy"`
	PassThroughBodyEnabled bool   `json:"pass_through_body_enabled,omitempty"`
	SystemPrompt           string `json:"system_prompt,omitempty"`
	SystemPromptOverride   bool   `json:"system_prompt_override,omitempty"`
}

type VertexKeyType string

const (
	VertexKeyTypeJSON   VertexKeyType = "json"
	VertexKeyTypeAPIKey VertexKeyType = "api_key"
)

type AwsKeyType string

const (
	AwsKeyTypeAKSK   AwsKeyType = "ak_sk" // 默认
	AwsKeyTypeApiKey AwsKeyType = "api_key"
)

type ChannelOtherSettings struct {
	AzureResponsesVersion                 string                            `json:"azure_responses_version,omitempty"`
	ResponsesCompatMode                   string                            `json:"responses_compat_mode,omitempty"`
	ResponsesCompatToolMode               string                            `json:"responses_compat_tool_mode,omitempty"`
	VertexKeyType                         VertexKeyType                     `json:"vertex_key_type,omitempty"` // "json" or "api_key"
	OpenRouterEnterprise                  *bool                             `json:"openrouter_enterprise,omitempty"`
	ClaudeBetaQuery                       bool                              `json:"claude_beta_query,omitempty"`         // Claude 渠道是否强制追加 ?beta=true
	AllowServiceTier                      bool                              `json:"allow_service_tier,omitempty"`        // 是否允许 service_tier 透传（默认过滤以避免额外计费）
	AllowInferenceGeo                     bool                              `json:"allow_inference_geo,omitempty"`       // 是否允许 inference_geo 透传（仅 Claude，默认过滤以满足数据驻留合规
	AllowSpeed                            bool                              `json:"allow_speed,omitempty"`               // 是否允许 speed 透传（仅 Claude，默认过滤以避免意外切换推理速度模式）
	AllowSafetyIdentifier                 bool                              `json:"allow_safety_identifier,omitempty"`   // 是否允许 safety_identifier 透传（默认过滤以保护用户隐私）
	DisableStore                          bool                              `json:"disable_store,omitempty"`             // 是否禁用 store 透传（默认允许透传，禁用后可能导致 Codex 无法使用）
	AllowIncludeObfuscation               bool                              `json:"allow_include_obfuscation,omitempty"` // 是否允许 stream_options.include_obfuscation 透传（默认过滤以避免关闭流混淆保护）
	AwsKeyType                            AwsKeyType                        `json:"aws_key_type,omitempty"`
	UpstreamModelUpdateCheckEnabled       bool                              `json:"upstream_model_update_check_enabled,omitempty"`        // 是否检测上游模型更新
	UpstreamModelUpdateAutoSyncEnabled    bool                              `json:"upstream_model_update_auto_sync_enabled,omitempty"`    // 是否自动同步上游模型更新
	UpstreamModelUpdateLastCheckTime      int64                             `json:"upstream_model_update_last_check_time,omitempty"`      // 上次检测时间
	UpstreamModelUpdateLastDetectedModels []string                          `json:"upstream_model_update_last_detected_models,omitempty"` // 上次检测到的可加入模型
	UpstreamModelUpdateLastRemovedModels  []string                          `json:"upstream_model_update_last_removed_models,omitempty"`  // 上次检测到的可删除模型
	UpstreamModelUpdateIgnoredModels      []string                          `json:"upstream_model_update_ignored_models,omitempty"`       // 手动忽略的模型
	UpstreamPricingCheckEnabled           bool                              `json:"upstream_pricing_check_enabled,omitempty"`             // 是否监控上游定价变动
	UpstreamPricingEndpoint               string                            `json:"upstream_pricing_endpoint,omitempty"`                  // 自定义定价接口路径（默认 /api/pricing）
	UpstreamPricingLastCheckTime          int64                             `json:"upstream_pricing_last_check_time,omitempty"`           // 上次检测时间戳
	UpstreamPricingLastSnapshot           map[string]map[string]interface{} `json:"upstream_pricing_last_snapshot,omitempty"`             // 上次上游定价快照
}

const (
	ResponsesCompatModeNative          = "native"
	ResponsesCompatModeChatCompletions = "chat_completions"
)

const (
	ResponsesCompatToolModeFunctionOnly        = "function_only"
	ResponsesCompatToolModeWrapNonFunction     = "wrap_non_function_tools"
	ResponsesCompatToolModeStrictError         = "strict_error"
	ContextKeyResponsesCompatToolMappings      = "responses_compat_tool_mappings"
	ContextKeyResponsesCompatToolReverseLookup = "responses_compat_tool_reverse_lookup"
)

type ResponsesCompatToolMapping struct {
	SafeName     string `json:"safe_name"`
	OriginalName string `json:"original_name"`
	OriginalType string `json:"original_type"`
	Wrapped      bool   `json:"wrapped"`
}

func (s *ChannelOtherSettings) IsOpenRouterEnterprise() bool {
	if s == nil || s.OpenRouterEnterprise == nil {
		return false
	}
	return *s.OpenRouterEnterprise
}
