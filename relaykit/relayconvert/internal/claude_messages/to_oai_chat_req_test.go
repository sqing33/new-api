package claudemessages

import (
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/relayconvert/convmeta"
	"github.com/samber/lo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClaudeMessagesRequestToOpenAIChatKeepsAssistantThinkingAsReasoningContent(t *testing.T) {
	got, err := ClaudeMessagesRequestToOpenAIChat(dto.ClaudeRequest{
		Model:     "claude-test",
		MaxTokens: lo.ToPtr(uint(64)),
		Messages: []dto.ClaudeMessage{
			{Role: "user", Content: "why is the sky blue?"},
			{Role: "assistant", Content: []dto.ClaudeMediaMessage{
				{Type: "thinking", Thinking: lo.ToPtr("Rayleigh scattering."), Signature: "sig"},
				{Type: "text", Text: lo.ToPtr("Short answer.")},
			}},
			{Role: "user", Content: "and the sunset?"},
		},
	}, &convmeta.Values{})
	require.NoError(t, err)

	require.Len(t, got.Messages, 3)
	assistant := got.Messages[1]
	assert.Equal(t, "assistant", assistant.Role)
	require.NotNil(t, assistant.ReasoningContent)
	assert.Equal(t, "Rayleigh scattering.", *assistant.ReasoningContent)
}
