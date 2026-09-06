package service

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// QuotaQueryPreset describes binding metadata and executable query availability.
type QuotaQueryPreset struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	CredentialMode      string   `json:"credential_mode"`
	SupportedKinds      []string `json:"supported_kinds"`
	RequiredExtraFields []string `json:"required_extra_fields,omitempty"`
	RequiredCredentials []string `json:"required_credentials,omitempty"`
	QueryImplemented    bool     `json:"query_implemented"`
}

func GetQuotaQueryPresets() []QuotaQueryPreset {
	return []QuotaQueryPreset{
		{ID: "glm_coding_plan_cn", Name: "GLM Coding Plan（国内版）", CredentialMode: "channel_key", QueryImplemented: true, SupportedKinds: []string{"quota_window"}},
		{ID: "glm_coding_plan_intl", Name: "GLM Coding Plan（国际版）", CredentialMode: "channel_key", QueryImplemented: true, SupportedKinds: []string{"quota_window"}},
		{ID: "glm_coding_plan_team", Name: "GLM Coding Plan（团队版）", CredentialMode: "channel_key", QueryImplemented: true, SupportedKinds: []string{"quota_window"}, RequiredExtraFields: []string{"organization_id", "project_id"}},
		{ID: "kimi_coding_plan", Name: "Kimi Coding Plan", CredentialMode: "channel_key", QueryImplemented: true, SupportedKinds: []string{"quota_window"}},
		{ID: "minimax_coding_plan_cn", Name: "MiniMax Coding Plan（国内版）", CredentialMode: "channel_key", QueryImplemented: true, SupportedKinds: []string{"quota_window"}},
		{ID: "minimax_coding_plan_intl", Name: "MiniMax Coding Plan（国际版）", CredentialMode: "channel_key", QueryImplemented: true, SupportedKinds: []string{"quota_window"}},
		{ID: "zenmux", Name: "ZenMux", CredentialMode: "channel_key", QueryImplemented: true, SupportedKinds: []string{"quota_window"}},
		{ID: "opencode_go", Name: "OpenCode Go", CredentialMode: "channel_key", QueryImplemented: true, SupportedKinds: []string{"quota_window"}},
		// Volcengine usage queries go through the control-plane OpenAPI
		// (open.volcengineapi.com) which requires SigV4 signing with a
		// dedicated AccessKey ID / Secret; the inference Bearer key is
		// rejected by the gateway (InvalidAuthorization). The AK/SK pair is
		// stored as the Key of a dedicated credential channel (JSON
		// {"access_key_id":...,"secret_access_key":...}) referenced via
		// quota_query_credential_channel_id, so it never flows through
		// inference traffic and is never returned by listing APIs.
		{ID: "volcengine_coding_plan", Name: "火山引擎 Coding Plan", CredentialMode: "separate", QueryImplemented: true, SupportedKinds: []string{"quota_window"}, RequiredExtraFields: []string{"region"}, RequiredCredentials: []string{"access_key_id", "secret_access_key"}},
		// new_api_subscription queries an upstream new-api instance's own
		// subscription quota via its dashboard API (GET {base_url}/api/
		// subscription/self). The forwarding sk- key cannot read it: the
		// endpoint authenticates a user PAT plus the New-Api-User id header.
		// The PAT and user id are stored in quota_query_extra (admin-only
		// settings JSON, same exposure class as the channel key field).
		{ID: "new_api_subscription", Name: "New API 订阅（上游实例）", CredentialMode: "separate", QueryImplemented: true, SupportedKinds: []string{"quota_window"}, RequiredExtraFields: []string{"access_token", "user_id"}},
	}
}

func IsQuotaQueryPresetSupported(id string) bool {
	for _, p := range GetQuotaQueryPresets() {
		if p.ID == id {
			return true
		}
	}
	return false
}

// DetectQuotaQueryPreset only proposes a binding from an exact URL identity.
func DetectQuotaQueryPreset(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return ""
	}
	host, path := strings.ToLower(u.Hostname()), strings.TrimRight(u.EscapedPath(), "/")
	switch host {
	case "open.bigmodel.cn", "bigmodel.cn":
		if path == "/api/coding/paas/v4" || path == "/api/anthropic" {
			return "glm_coding_plan_cn"
		}
	case "api.z.ai":
		if path == "/api/coding/paas/v4" || path == "/api/anthropic" {
			return "glm_coding_plan_intl"
		}
	case "api.kimi.com":
		if path == "/coding" || path == "/coding/v1" {
			return "kimi_coding_plan"
		}
	case "api.minimaxi.com":
		if path == "/anthropic" || path == "/v1" {
			return "minimax_coding_plan_cn"
		}
	case "api.minimax.io":
		if path == "/anthropic" || path == "/v1" {
			return "minimax_coding_plan_intl"
		}
	case "opencode.ai":
		if path == "/zen/go" || path == "/zen/go/v1" {
			return "opencode_go"
		}
	case "zenmux.ai":
		if path == "/api/v1" || path == "/api/anthropic" || path == "/api/vertex-ai" {
			return "zenmux"
		}
	}
	return ""
}

func ParseQuotaQuerySettings(raw string) (dto.ChannelOtherSettings, error) {
	var s dto.ChannelOtherSettings
	if raw == "" {
		return s, nil
	}
	var fields map[string]any
	if err := common.UnmarshalJsonStr(raw, &fields); err != nil || fields == nil {
		return s, fmt.Errorf("other_settings must be a JSON object")
	}
	for k := range fields {
		if strings.HasPrefix(k, "quota_query_") && k != "quota_query_preset_id" && k != "quota_query_credential_mode" && k != "quota_query_key_index" && k != "quota_query_extra" && k != "quota_query_credential_channel_id" {
			return s, fmt.Errorf("unsupported quota query field")
		}
	}
	if err := common.UnmarshalJsonStr(raw, &s); err != nil {
		return s, fmt.Errorf("invalid quota query settings")
	}
	return s, nil
}

// ResolveQuotaQueryCredentialChannel loads the channel referenced by
// quota_query_credential_channel_id. It returns nil when no reference is set.
// The referenced Key is dedicated query credential material (volcengine
// AK/SK JSON, ZenMux management key) and is never returned to clients.
func ResolveQuotaQueryCredentialChannel(s dto.ChannelOtherSettings) (*model.Channel, error) {
	if s.QuotaQueryCredentialChannelID == nil || *s.QuotaQueryCredentialChannelID <= 0 {
		return nil, nil
	}
	ref, err := model.GetChannelById(*s.QuotaQueryCredentialChannelID, true)
	if err != nil || ref == nil {
		return nil, fmt.Errorf("quota query credential channel not found")
	}
	return ref, nil
}

func ValidateQuotaQueryBinding(ch *model.Channel) error {
	s, err := ParseQuotaQuerySettings(ch.OtherSettings)
	if err != nil {
		return err
	}
	id := s.QuotaQueryPresetID
	if id != "" && id != "auto" && id != "disabled" && !IsQuotaQueryPresetSupported(id) {
		return fmt.Errorf("unsupported quota query preset")
	}
	mode := s.QuotaQueryCredentialMode
	if mode != "" && mode != "channel_key" && mode != "separate" {
		return fmt.Errorf("unsupported quota query credential mode")
	}
	if s.QuotaQueryKeyIndex != nil {
		count := 0
		if strings.TrimSpace(ch.Key) != "" {
			count = 1
			if ch.ChannelInfo.IsMultiKey {
				count = len(ch.GetKeys())
			}
		}
		if *s.QuotaQueryKeyIndex < 0 || *s.QuotaQueryKeyIndex >= count {
			return fmt.Errorf("quota query key index out of bounds")
		}
	}
	if s.QuotaQueryCredentialChannelID != nil {
		if *s.QuotaQueryCredentialChannelID <= 0 {
			return fmt.Errorf("invalid quota query credential channel")
		}
		if ch.Id != 0 && *s.QuotaQueryCredentialChannelID == ch.Id {
			return fmt.Errorf("quota query credential channel cannot reference itself")
		}
		if _, err := model.GetChannelById(*s.QuotaQueryCredentialChannelID, true); err != nil {
			return fmt.Errorf("quota query credential channel not found")
		}
	}
	resolved := id
	if id == "auto" {
		resolved = DetectQuotaQueryPreset(ch.GetBaseURL())
	}
	allowed := map[string]bool{}
	for _, p := range GetQuotaQueryPresets() {
		if p.ID == resolved {
			for _, k := range p.RequiredExtraFields {
				allowed[k] = true
			}
		}
	}
	for k, v := range s.QuotaQueryExtra {
		if !allowed[k] {
			return fmt.Errorf("unsupported quota query extra field")
		}
		if len(v) > 256 || strings.ContainsAny(v, "\r\n") {
			return fmt.Errorf("invalid quota query extra value")
		}
	}
	return nil
}

type QuotaQueryConfig struct {
	ChannelID        int               `json:"channel_id"`
	PresetID         string            `json:"preset_id"`
	ResolvedPresetID string            `json:"resolved_preset_id"`
	CredentialMode   string            `json:"credential_mode"`
	KeyIndex         *int              `json:"key_index"`
	Extra            map[string]string `json:"extra"`
	// CredentialChannelID echoes the configured reference so the frontend can
	// render it; it is an ID only and never exposes credential contents.
	CredentialChannelID    *int     `json:"credential_channel_id,omitempty"`
	Status                 string   `json:"status"`
	MissingFields          []string `json:"missing_fields"`
	Configured             bool     `json:"configured"`
	Valid                  bool     `json:"valid"`
	QueryImplemented       bool     `json:"query_implemented"`
	CanQuery               bool     `json:"can_query"`
	SecretStorageSupported bool     `json:"secret_storage_supported"`
}

func GetQuotaQueryConfig(ch *model.Channel) (QuotaQueryConfig, error) {
	return GetQuotaQueryConfigWithOption(ch, QuotaQueryOption{})
}

// GetQuotaQueryConfigWithOption computes the effective binding view under a
// per-request key_index override. The override is validated against the
// channel's key count BEFORE the status is derived, so a multi-key channel
// with a valid override reports ready instead of a spurious missing key_index.
// The channel is never mutated and nothing is persisted.
func GetQuotaQueryConfigWithOption(ch *model.Channel, opt QuotaQueryOption) (QuotaQueryConfig, error) {
	s, err := ParseQuotaQuerySettings(ch.OtherSettings)
	if err != nil {
		return QuotaQueryConfig{}, err
	}
	if err := ValidateQuotaQueryBinding(ch); err != nil {
		return QuotaQueryConfig{}, err
	}
	cfg := QuotaQueryConfig{ChannelID: ch.Id, PresetID: s.QuotaQueryPresetID, CredentialMode: s.QuotaQueryCredentialMode, KeyIndex: s.QuotaQueryKeyIndex, Extra: s.QuotaQueryExtra, CredentialChannelID: s.QuotaQueryCredentialChannelID, Status: "disabled", MissingFields: []string{}, Valid: true, SecretStorageSupported: true}
	if cfg.Extra == nil {
		cfg.Extra = map[string]string{}
	}
	if cfg.PresetID == "" || cfg.PresetID == "disabled" {
		return cfg, nil
	}
	// Apply the per-request override on a copy before deriving status.
	if opt.KeyIndex != nil {
		keyCount := 0
		if strings.TrimSpace(ch.Key) != "" {
			keyCount = 1
			if ch.ChannelInfo.IsMultiKey {
				keyCount = len(ch.GetKeys())
			}
		}
		if *opt.KeyIndex < 0 || *opt.KeyIndex >= keyCount {
			return QuotaQueryConfig{}, fmt.Errorf("quota query key index out of bounds")
		}
		cfg.KeyIndex = opt.KeyIndex
	}
	cfg.Configured = true
	cfg.ResolvedPresetID = cfg.PresetID
	if cfg.PresetID == "auto" {
		cfg.ResolvedPresetID = DetectQuotaQueryPreset(ch.GetBaseURL())
	}
	if cfg.ResolvedPresetID == "" {
		cfg.Status = "unresolved"
		return cfg, nil
	}
	cfg.Status = "unsupported"
	if ch.ChannelInfo.IsMultiKey && cfg.KeyIndex == nil {
		cfg.MissingFields = append(cfg.MissingFields, "key_index")
	}
	for _, p := range GetQuotaQueryPresets() {
		if p.ID != cfg.ResolvedPresetID {
			continue
		}
		cfg.QueryImplemented = p.QueryImplemented
		if cfg.CredentialMode == "" {
			cfg.CredentialMode = p.CredentialMode
		}
		for _, k := range p.RequiredExtraFields {
			if strings.TrimSpace(cfg.Extra[k]) == "" {
				cfg.MissingFields = append(cfg.MissingFields, k)
			}
		}
		usesChannelKey := strings.TrimSpace(ch.Key) == ""
		// channel_key presets read the channel's own key unless a credential
		// channel reference supplies a dedicated key (e.g. a ZenMux
		// management key that differs from the inference key).
		if s.QuotaQueryCredentialChannelID != nil {
			usesChannelKey = false
		}
		if p.CredentialMode == "separate" {
			if len(p.RequiredExtraFields) > 0 && len(p.RequiredCredentials) == 0 {
				// new_api_subscription carries its query credential (PAT +
				// user id) in quota_query_extra; the RequiredExtraFields loop
				// above already reports each missing field, and the channel
				// key is irrelevant for this preset.
				usesChannelKey = false
			} else if s.QuotaQueryCredentialChannelID == nil {
				// Dedicated AK/SK credentials must come from the referenced
				// credential channel; without it the required credentials are
				// reported missing.
				cfg.MissingFields = append(cfg.MissingFields, p.RequiredCredentials...)
				cfg.MissingFields = append(cfg.MissingFields, "credential_channel_id")
			}
		} else if cfg.CredentialMode == "separate" && s.QuotaQueryCredentialChannelID == nil {
			cfg.MissingFields = append(cfg.MissingFields, "credential")
		} else if usesChannelKey {
			cfg.MissingFields = append(cfg.MissingFields, "channel_key")
		}
	}
	if len(cfg.MissingFields) > 0 {
		cfg.Status = "needs_configuration"
	} else if cfg.QueryImplemented {
		cfg.Status = "ready"
		cfg.CanQuery = true
	}
	return cfg, nil
}
