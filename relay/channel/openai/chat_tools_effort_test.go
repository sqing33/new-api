package openai

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConvertOpenAIRequestForcesNoneEffortForGPT6FunctionTools(t *testing.T) {
	tool := dto.ToolCallRequest{Type: "function", Function: dto.FunctionRequest{Name: "get_weather"}}
	tests := []struct {
		name          string
		upstreamModel string
		tools         []dto.ToolCallRequest
		effort        string
		wantEffort    string
	}{
		{name: "gpt6 tools with high effort downgraded", upstreamModel: "gpt-6-astra", tools: []dto.ToolCallRequest{tool}, effort: "high", wantEffort: "none"},
		{name: "gpt6 tools without effort downgraded", upstreamModel: "gpt-6-astra", tools: []dto.ToolCallRequest{tool}, effort: "", wantEffort: "none"},
		{name: "gpt6 snapshot tools downgraded", upstreamModel: "gpt-6-astra-2026-09-03", tools: []dto.ToolCallRequest{tool}, effort: "medium", wantEffort: "none"},
		{name: "gpt6 explicit none preserved", upstreamModel: "gpt-6-astra", tools: []dto.ToolCallRequest{tool}, effort: "none", wantEffort: "none"},
		{name: "gpt6 without tools keeps effort", upstreamModel: "gpt-6-astra", effort: "high", wantEffort: "high"},
		{name: "gpt5 tools untouched", upstreamModel: "gpt-5.4", tools: []dto.ToolCallRequest{tool}, effort: "high", wantEffort: "high"},
		{name: "gpt4 tools untouched", upstreamModel: "gpt-4.1", tools: []dto.ToolCallRequest{tool}, effort: "high", wantEffort: "high"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := &dto.GeneralOpenAIRequest{
				Model:           tt.upstreamModel,
				Messages:        []dto.Message{{Role: "user", Content: "hi"}},
				ReasoningEffort: tt.effort,
			}
			if tt.tools != nil {
				request.Tools = tt.tools
			}
			info := &relaycommon.RelayInfo{
				OriginModelName: tt.upstreamModel,
				ChannelMeta: &relaycommon.ChannelMeta{
					UpstreamModelName: tt.upstreamModel,
				},
			}

			convertedValue, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, request)
			require.NoError(t, err)
			converted, ok := convertedValue.(*dto.GeneralOpenAIRequest)
			require.True(t, ok)

			assert.Equal(t, tt.wantEffort, converted.ReasoningEffort)
			assert.Equal(t, tt.wantEffort, info.GetReasoningEffort())
			if tt.wantEffort == "none" && tt.effort != "none" {
				assert.Nil(t, converted.Reasoning)
			}
		})
	}
}
