package openaicompat

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/stretchr/testify/require"
)

func rawJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := common.Marshal(value)
	require.NoError(t, err)
	return raw
}

func TestResponsesRequestToChatCompletionsRequestBasic(t *testing.T) {
	stream := true
	maxTokens := uint(128)
	temperature := 0.2
	req := &dto.OpenAIResponsesRequest{
		Model:           "MiniMax-M2.7",
		Input:           rawJSON(t, "hello"),
		Instructions:    rawJSON(t, "be precise"),
		Stream:          &stream,
		MaxOutputTokens: &maxTokens,
		Temperature:     &temperature,
		Tools: rawJSON(t, []map[string]any{
			{
				"type":        "function",
				"name":        "lookup",
				"description": "lookup something",
				"parameters": map[string]any{
					"type": "object",
				},
			},
		}),
		ToolChoice: rawJSON(t, map[string]any{
			"type": "function",
			"name": "lookup",
		}),
		Text: rawJSON(t, map[string]any{
			"format": map[string]any{
				"type": "json_schema",
				"name": "answer",
				"schema": map[string]any{
					"type": "object",
				},
			},
		}),
	}

	chatReq, err := ResponsesRequestToChatCompletionsRequest(req)
	require.NoError(t, err)
	require.Equal(t, "MiniMax-M2.7", chatReq.Model)
	require.Len(t, chatReq.Messages, 2)
	require.Equal(t, "system", chatReq.Messages[0].Role)
	require.Equal(t, "be precise", chatReq.Messages[0].StringContent())
	require.Equal(t, "user", chatReq.Messages[1].Role)
	require.Equal(t, "hello", chatReq.Messages[1].StringContent())
	require.NotNil(t, chatReq.Stream)
	require.True(t, *chatReq.Stream)
	require.NotNil(t, chatReq.MaxTokens)
	require.Equal(t, maxTokens, *chatReq.MaxTokens)
	require.NotNil(t, chatReq.Temperature)
	require.Equal(t, temperature, *chatReq.Temperature)
	require.Len(t, chatReq.Tools, 1)
	require.Equal(t, "lookup", chatReq.Tools[0].Function.Name)
	require.Equal(t, "json_schema", chatReq.ResponseFormat.Type)

	toolChoice, ok := chatReq.ToolChoice.(map[string]any)
	require.True(t, ok)
	require.Equal(t, "function", toolChoice["type"])
	fn, ok := toolChoice["function"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "lookup", fn["name"])
}

func TestResponsesRequestToChatCompletionsRequestWrapsNonFunctionTools(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "MiniMax-M2.7",
		Input: rawJSON(t, "hello"),
		Tools: rawJSON(t, []map[string]any{
			{
				"type":        "custom",
				"name":        "functions.apply_patch",
				"description": "apply a patch",
			},
			{
				"type":        "mcp",
				"name":        "functions/apply_patch",
				"description": "duplicate after sanitizing",
				"input_schema": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"patch": map[string]any{"type": "string"},
					},
				},
			},
		}),
		ToolChoice: rawJSON(t, map[string]any{
			"type": "custom",
			"name": "functions.apply_patch",
		}),
	}

	chatReq, mappings, err := ResponsesRequestToChatCompletionsRequestWithToolMode(req, dto.ResponsesCompatToolModeWrapNonFunction)
	require.NoError(t, err)
	require.Len(t, chatReq.Tools, 2)
	require.Equal(t, "functions_apply_patch", chatReq.Tools[0].Function.Name)
	require.Equal(t, "functions_apply_patch_2", chatReq.Tools[1].Function.Name)
	require.Equal(t, map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"properties": map[string]any{
			"input": map[string]any{
				"type":        "string",
				"description": "Tool input. Use this when the original tool accepts free-form text or an unknown schema.",
			},
		},
	}, chatReq.Tools[0].Function.Parameters)
	require.Equal(t, "functions.apply_patch", mappings["functions_apply_patch"].OriginalName)
	require.Equal(t, "custom", mappings["functions_apply_patch"].OriginalType)
	require.True(t, mappings["functions_apply_patch"].Wrapped)

	toolChoice, ok := chatReq.ToolChoice.(map[string]any)
	require.True(t, ok)
	fn, ok := toolChoice["function"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "functions_apply_patch", fn["name"])
}

func TestResponsesRequestToChatCompletionsRequestFunctionOnlySkipsNonFunctionTools(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "MiniMax-M2.7",
		Tools: rawJSON(t, []map[string]any{
			{"type": "custom", "name": "web.run"},
			{"type": "function", "name": "lookup"},
		}),
	}

	chatReq, mappings, err := ResponsesRequestToChatCompletionsRequestWithToolMode(req, dto.ResponsesCompatToolModeFunctionOnly)
	require.NoError(t, err)
	require.Len(t, chatReq.Tools, 1)
	require.Equal(t, "lookup", chatReq.Tools[0].Function.Name)
	require.False(t, mappings["lookup"].Wrapped)
}

func TestResponsesRequestToChatCompletionsRequestSanitizesFunctionNamesWithoutWrappingType(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "MiniMax-M2.7",
		Tools: rawJSON(t, []map[string]any{
			{"type": "function", "name": "functions.apply_patch"},
		}),
	}

	chatReq, mappings, err := ResponsesRequestToChatCompletionsRequestWithToolMode(req, dto.ResponsesCompatToolModeWrapNonFunction)
	require.NoError(t, err)
	require.Len(t, chatReq.Tools, 1)
	require.Equal(t, "functions_apply_patch", chatReq.Tools[0].Function.Name)
	require.Equal(t, "functions.apply_patch", mappings["functions_apply_patch"].OriginalName)
	require.False(t, mappings["functions_apply_patch"].Wrapped)
}

func TestResponsesRequestToChatCompletionsRequestStrictErrorsOnNonFunctionTools(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "MiniMax-M2.7",
		Tools: rawJSON(t, []map[string]any{
			{"type": "custom", "name": "web.run"},
		}),
	}

	_, _, err := ResponsesRequestToChatCompletionsRequestWithToolMode(req, dto.ResponsesCompatToolModeStrictError)
	require.Error(t, err)
	require.Contains(t, err.Error(), "cannot be represented")
}

func TestResponsesRequestToChatCompletionsRequestCustomToolHistory(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "MiniMax-M2.7",
		Input: rawJSON(t, []map[string]any{
			{
				"type":    "custom_tool_call",
				"call_id": "call_custom",
				"name":    "web.run",
				"input":   `{"search_query":[{"q":"new-api"}]}`,
			},
			{
				"type":    "custom_tool_call_output",
				"call_id": "call_custom",
				"output":  "result",
			},
		}),
	}

	chatReq, err := ResponsesRequestToChatCompletionsRequest(req)
	require.NoError(t, err)
	require.Len(t, chatReq.Messages, 2)
	toolCalls := chatReq.Messages[0].ParseToolCalls()
	require.Len(t, toolCalls, 1)
	require.Equal(t, "call_custom", toolCalls[0].ID)
	require.Equal(t, "web.run", toolCalls[0].Function.Name)
	require.Equal(t, `{"search_query":[{"q":"new-api"}]}`, toolCalls[0].Function.Arguments)
	require.Equal(t, "tool", chatReq.Messages[1].Role)
	require.Equal(t, "call_custom", chatReq.Messages[1].ToolCallId)
	require.Equal(t, "result", chatReq.Messages[1].StringContent())
}

func TestResponsesRequestToChatCompletionsRequestPreservesExplicitZeroValues(t *testing.T) {
	stream := false
	maxTokens := uint(0)
	temperature := 0.0
	topP := 0.0
	req := &dto.OpenAIResponsesRequest{
		Model:             "MiniMax-M2.7",
		Input:             rawJSON(t, "hello"),
		Stream:            &stream,
		MaxOutputTokens:   &maxTokens,
		Temperature:       &temperature,
		TopP:              &topP,
		ParallelToolCalls: rawJSON(t, false),
	}

	chatReq, err := ResponsesRequestToChatCompletionsRequest(req)
	require.NoError(t, err)
	require.NotNil(t, chatReq.Stream)
	require.False(t, *chatReq.Stream)
	require.NotNil(t, chatReq.MaxTokens)
	require.Equal(t, uint(0), *chatReq.MaxTokens)
	require.NotNil(t, chatReq.Temperature)
	require.Equal(t, 0.0, *chatReq.Temperature)
	require.NotNil(t, chatReq.TopP)
	require.Equal(t, 0.0, *chatReq.TopP)
	require.NotNil(t, chatReq.ParallelTooCalls)
	require.False(t, *chatReq.ParallelTooCalls)
}

func TestResponsesRequestToChatCompletionsRequestIgnoresNullInputAndInstructions(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model:        "MiniMax-M2.7",
		Input:        rawJSON(t, nil),
		Instructions: rawJSON(t, nil),
	}

	chatReq, err := ResponsesRequestToChatCompletionsRequest(req)
	require.NoError(t, err)
	require.Empty(t, chatReq.Messages)
}

func TestResponsesRequestToChatCompletionsRequestNormalizesDeveloperRole(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "MiniMax-M2.7",
		Input: rawJSON(t, []map[string]any{
			{
				"role": "developer",
				"content": []map[string]any{
					{"type": "input_text", "text": "be concise"},
				},
			},
			{
				"role":    "user",
				"content": "hello",
			},
		}),
	}

	chatReq, err := ResponsesRequestToChatCompletionsRequest(req)
	require.NoError(t, err)
	require.Len(t, chatReq.Messages, 2)
	require.Equal(t, "system", chatReq.Messages[0].Role)
	require.Equal(t, "be concise", chatReq.Messages[0].StringContent())
	require.Equal(t, "user", chatReq.Messages[1].Role)
}

func TestResponsesRequestToChatCompletionsRequestCollapsesSystemMessages(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model:        "MiniMax-M2.7",
		Instructions: rawJSON(t, "top-level instructions"),
		Input: rawJSON(t, []map[string]any{
			{
				"role": "developer",
				"content": []map[string]any{
					{"type": "input_text", "text": "developer instructions"},
				},
			},
			{
				"role":    "user",
				"content": "hello",
			},
		}),
	}

	chatReq, err := ResponsesRequestToChatCompletionsRequest(req)
	require.NoError(t, err)
	require.Len(t, chatReq.Messages, 2)
	require.Equal(t, "system", chatReq.Messages[0].Role)
	require.Contains(t, chatReq.Messages[0].StringContent(), "top-level instructions")
	require.Contains(t, chatReq.Messages[0].StringContent(), "developer instructions")
	require.Equal(t, "user", chatReq.Messages[1].Role)
}

func TestResponsesRequestToChatCompletionsRequestToolHistory(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "MiniMax-M2.7",
		Input: rawJSON(t, []map[string]any{
			{
				"role": "assistant",
				"content": []map[string]any{
					{"type": "output_text", "text": "checking"},
				},
			},
			{
				"type":      "function_call",
				"call_id":   "call_123",
				"name":      "lookup",
				"arguments": `{"q":"new-api"}`,
			},
			{
				"type":    "function_call_output",
				"call_id": "call_123",
				"output":  "result",
			},
		}),
	}

	chatReq, err := ResponsesRequestToChatCompletionsRequest(req)
	require.NoError(t, err)
	require.Len(t, chatReq.Messages, 3)
	require.Equal(t, "assistant", chatReq.Messages[0].Role)
	require.Equal(t, "checking", chatReq.Messages[0].StringContent())
	require.Equal(t, "assistant", chatReq.Messages[1].Role)
	toolCalls := chatReq.Messages[1].ParseToolCalls()
	require.Len(t, toolCalls, 1)
	require.Equal(t, "call_123", toolCalls[0].ID)
	require.Equal(t, "lookup", toolCalls[0].Function.Name)
	require.Equal(t, `{"q":"new-api"}`, toolCalls[0].Function.Arguments)
	require.Equal(t, "tool", chatReq.Messages[2].Role)
	require.Equal(t, "call_123", chatReq.Messages[2].ToolCallId)
	require.Equal(t, "result", chatReq.Messages[2].StringContent())
}

func TestResponsesRequestToChatCompletionsRequestOrphanToolOutputBecomesUserContext(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "MiniMax-M2.7",
		Input: rawJSON(t, []map[string]any{
			{
				"type":    "function_call_output",
				"call_id": "call_missing",
				"output":  "orphan result",
			},
			{
				"role":    "user",
				"content": "hello",
			},
		}),
	}

	chatReq, err := ResponsesRequestToChatCompletionsRequest(req)
	require.NoError(t, err)
	require.Len(t, chatReq.Messages, 2)
	require.Equal(t, "user", chatReq.Messages[0].Role)
	require.Contains(t, chatReq.Messages[0].StringContent(), "call_missing")
	require.Contains(t, chatReq.Messages[0].StringContent(), "orphan result")
	require.Equal(t, "", chatReq.Messages[0].ToolCallId)
	require.Equal(t, "user", chatReq.Messages[1].Role)
}

func TestChatCompletionsResponseToResponsesResponseText(t *testing.T) {
	chatResp := &dto.OpenAITextResponse{
		Id:      "chatcmpl_123",
		Object:  "chat.completion",
		Created: float64(12345),
		Model:   "MiniMax-M2.7",
		Choices: []dto.OpenAITextResponseChoice{
			{
				Index: 0,
				Message: dto.Message{
					Role:    "assistant",
					Content: "hello",
				},
				FinishReason: "stop",
			},
		},
		Usage: dto.Usage{
			PromptTokens:     3,
			CompletionTokens: 5,
			TotalTokens:      8,
		},
	}

	resp, usage, err := ChatCompletionsResponseToResponsesResponse(chatResp, "resp_123")
	require.NoError(t, err)
	require.Equal(t, "resp_123", resp.ID)
	require.Equal(t, "response", resp.Object)
	require.Equal(t, 12345, resp.CreatedAt)
	require.Equal(t, "MiniMax-M2.7", resp.Model)
	require.Len(t, resp.Output, 1)
	require.Equal(t, "message", resp.Output[0].Type)
	require.Equal(t, "assistant", resp.Output[0].Role)
	require.Equal(t, "output_text", resp.Output[0].Content[0].Type)
	require.Equal(t, "hello", resp.Output[0].Content[0].Text)
	require.Equal(t, 3, usage.InputTokens)
	require.Equal(t, 5, usage.OutputTokens)
	require.Equal(t, 8, usage.TotalTokens)
}

func TestChatCompletionsResponseToResponsesResponseToolCalls(t *testing.T) {
	message := dto.Message{Role: "assistant", Content: ""}
	message.SetToolCalls([]dto.ToolCallRequest{
		{
			ID:   "call_123",
			Type: "function",
			Function: dto.FunctionRequest{
				Name:      "lookup",
				Arguments: `{"q":"new-api"}`,
			},
		},
	})
	chatResp := &dto.OpenAITextResponse{
		Model: "MiniMax-M2.7",
		Choices: []dto.OpenAITextResponseChoice{
			{
				Index:        0,
				Message:      message,
				FinishReason: "tool_calls",
			},
		},
	}

	resp, _, err := ChatCompletionsResponseToResponsesResponse(chatResp, "resp_123")
	require.NoError(t, err)
	require.Len(t, resp.Output, 1)
	require.Equal(t, "function_call", resp.Output[0].Type)
	require.Equal(t, "call_123", resp.Output[0].CallId)
	require.Equal(t, "lookup", resp.Output[0].Name)
	require.Equal(t, `{"q":"new-api"}`, resp.Output[0].ArgumentsString())
}

func TestChatCompletionsResponseToResponsesResponseRestoresWrappedToolNames(t *testing.T) {
	message := dto.Message{Role: "assistant", Content: ""}
	message.SetToolCalls([]dto.ToolCallRequest{
		{
			ID:   "call_123",
			Type: "function",
			Function: dto.FunctionRequest{
				Name:      "web_run",
				Arguments: `{"input":"search new-api"}`,
			},
		},
	})
	chatResp := &dto.OpenAITextResponse{
		Model: "MiniMax-M2.7",
		Choices: []dto.OpenAITextResponseChoice{
			{
				Index:        0,
				Message:      message,
				FinishReason: "tool_calls",
			},
		},
	}

	resp, _, err := ChatCompletionsResponseToResponsesResponseWithToolMappings(chatResp, "resp_123", map[string]dto.ResponsesCompatToolMapping{
		"web_run": {
			SafeName:     "web_run",
			OriginalName: "web.run",
			OriginalType: "custom",
			Wrapped:      true,
		},
	})
	require.NoError(t, err)
	require.Len(t, resp.Output, 1)
	require.Equal(t, "custom_tool_call", resp.Output[0].Type)
	require.Equal(t, "web.run", resp.Output[0].Name)
	require.Equal(t, `"search new-api"`, string(resp.Output[0].Input))
}
