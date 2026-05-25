package openai

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

type responsesCompatToolState struct {
	OutputIndex int
	ItemID      string
	CallID      string
	Name        string
	Type        string
	Arguments   strings.Builder
	Done        bool
}

func ChatCompletionsToResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	defer service.CloseResponseBodyGracefully(resp)

	var chatResp dto.OpenAITextResponse
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	if err := common.Unmarshal(body, &chatResp); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := chatResp.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	responsesResp, usage, err := service.ChatCompletionsResponseToResponsesResponseWithToolMappings(&chatResp, responsesCompatResponseID(c), responsesCompatToolMappings(c))
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if usage == nil || usage.TotalTokens == 0 {
		usage = service.ResponseText2Usage(c, service.ExtractOutputTextFromResponses(responsesResp), info.UpstreamModelName, info.GetEstimatePromptTokens())
		responsesResp.Usage = usage
	}

	responseBody, err := common.Marshal(responsesResp)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError)
	}
	service.IOCopyBytesGracefully(c, resp, responseBody)
	return usage, nil
}

func ChatCompletionsToResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	responseID := responsesCompatResponseID(c)
	createdAt := time.Now().Unix()
	model := info.UpstreamModelName
	usage := &dto.Usage{}
	var usageText strings.Builder
	var streamErr *types.NewAPIError

	nextOutputIndex := 0
	textOutputIndex := -1
	textItemID := "msg_" + responseID
	var outputText strings.Builder
	textItemStarted := false
	textItemDone := false
	var reasoningSummary strings.Builder
	sequenceNumber := 0
	sendEvent := func(eventType string, payload map[string]any) error {
		return sendResponsesCompatEvent(c, eventType, payload, &sequenceNumber)
	}

	toolByIndex := make(map[int]*responsesCompatToolState)
	toolOrder := make([]*responsesCompatToolState, 0)

	helper.SetEventStreamHeaders(c)
	if err := sendEvent("response.created", map[string]any{
		"response": responsesCompatResponseObject(responseID, createdAt, model, "in_progress", nil, nil),
	}); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	if err := sendEvent("response.in_progress", map[string]any{
		"response": responsesCompatResponseObject(responseID, createdAt, model, "in_progress", nil, nil),
	}); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	ensureTextItem := func() bool {
		if textItemStarted {
			return true
		}
		textOutputIndex = nextOutputIndex
		nextOutputIndex++
		item := responsesCompatMessageOutput(textItemID, "in_progress", "")
		if err := sendEvent("response.output_item.added", map[string]any{
			"output_index": textOutputIndex,
			"item":         item,
		}); err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
			return false
		}
		if err := sendEvent("response.content_part.added", map[string]any{
			"item_id":       textItemID,
			"output_index":  textOutputIndex,
			"content_index": 0,
			"part": map[string]any{
				"type":        "output_text",
				"text":        "",
				"annotations": []any{},
				"logprobs":    []any{},
			},
		}); err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
			return false
		}
		textItemStarted = true
		return true
	}

	finishTextItem := func() bool {
		if !textItemStarted || textItemDone {
			return true
		}
		text := outputText.String()
		if err := sendEvent("response.output_text.done", map[string]any{
			"item_id":       textItemID,
			"output_index":  textOutputIndex,
			"content_index": 0,
			"text":          text,
			"logprobs":      []any{},
		}); err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
			return false
		}
		part := map[string]any{
			"type":        "output_text",
			"text":        text,
			"annotations": []any{},
			"logprobs":    []any{},
		}
		if err := sendEvent("response.content_part.done", map[string]any{
			"item_id":       textItemID,
			"output_index":  textOutputIndex,
			"content_index": 0,
			"part":          part,
		}); err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
			return false
		}
		if err := sendEvent("response.output_item.done", map[string]any{
			"output_index": textOutputIndex,
			"item":         responsesCompatMessageOutput(textItemID, "completed", text),
		}); err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
			return false
		}
		textItemDone = true
		return true
	}

	ensureToolItem := func(index int, tool dto.ToolCallResponse) (*responsesCompatToolState, bool) {
		if index < 0 {
			index = len(toolByIndex)
		}
		if state, ok := toolByIndex[index]; ok {
			if tool.ID != "" {
				state.CallID = tool.ID
			}
			if tool.Function.Name != "" {
				responsesCompatApplyToolMapping(state, tool.Function.Name, responsesCompatToolMappings(c))
			}
			return state, true
		}
		callID := strings.TrimSpace(tool.ID)
		if callID == "" {
			callID = fmt.Sprintf("call_%d", index)
		}
		state := &responsesCompatToolState{
			OutputIndex: nextOutputIndex,
			ItemID:      "fc_" + callID,
			CallID:      callID,
			Name:        tool.Function.Name,
			Type:        "function_call",
		}
		responsesCompatApplyToolMapping(state, tool.Function.Name, responsesCompatToolMappings(c))
		nextOutputIndex++
		toolByIndex[index] = state
		toolOrder = append(toolOrder, state)
		if err := sendEvent("response.output_item.added", map[string]any{
			"output_index": state.OutputIndex,
			"item":         responsesCompatToolOutput(state, "in_progress"),
		}); err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
			return nil, false
		}
		return state, true
	}

	finishToolItems := func() bool {
		for _, state := range toolOrder {
			if state.Done {
				continue
			}
			arguments := state.Arguments.String()
			if err := sendEvent("response.function_call_arguments.done", map[string]any{
				"item_id":      state.ItemID,
				"output_index": state.OutputIndex,
				"arguments":    arguments,
			}); err != nil {
				streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
				return false
			}
			if err := sendEvent("response.output_item.done", map[string]any{
				"output_index": state.OutputIndex,
				"item":         responsesCompatToolOutput(state, "completed"),
			}); err != nil {
				streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
				return false
			}
			state.Done = true
		}
		return true
	}

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		if streamErr != nil {
			sr.Stop(streamErr)
			return
		}
		if data == "[DONE]" || strings.TrimSpace(data) == "" {
			return
		}

		var chunk dto.ChatCompletionsStreamResponse
		if err := common.UnmarshalJsonStr(data, &chunk); err != nil {
			logger.LogError(c, "failed to unmarshal chat completion stream chunk: "+err.Error())
			sr.Error(err)
			return
		}
		if chunk.Model != "" {
			model = chunk.Model
		}
		if chunk.Usage != nil {
			usage = responsesCompatUsageFromChat(chunk.Usage)
		}

		for _, choice := range chunk.Choices {
			if reasoning := choice.Delta.GetReasoningContent(); reasoning != "" {
				reasoningSummary.WriteString(reasoning)
				usageText.WriteString(reasoning)
			}
			if content := choice.Delta.GetContentString(); content != "" {
				if !ensureTextItem() {
					sr.Stop(streamErr)
					return
				}
				outputText.WriteString(content)
				usageText.WriteString(content)
				if err := sendEvent("response.output_text.delta", map[string]any{
					"item_id":       textItemID,
					"output_index":  textOutputIndex,
					"content_index": 0,
					"delta":         content,
					"logprobs":      []any{},
				}); err != nil {
					streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
					sr.Stop(streamErr)
					return
				}
			}
			for _, tool := range choice.Delta.ToolCalls {
				index := len(toolByIndex)
				if tool.Index != nil {
					index = *tool.Index
				}
				state, ok := ensureToolItem(index, tool)
				if !ok {
					sr.Stop(streamErr)
					return
				}
				if tool.Function.Arguments != "" {
					state.Arguments.WriteString(tool.Function.Arguments)
					usageText.WriteString(tool.Function.Arguments)
					if err := sendEvent("response.function_call_arguments.delta", map[string]any{
						"item_id":      state.ItemID,
						"output_index": state.OutputIndex,
						"delta":        tool.Function.Arguments,
					}); err != nil {
						streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
						sr.Stop(streamErr)
						return
					}
				}
			}
		}
	})

	if streamErr != nil {
		return nil, streamErr
	}
	if !textItemStarted && reasoningSummary.Len() > 0 {
		text := reasoningSummary.String()
		if !ensureTextItem() {
			return nil, streamErr
		}
		outputText.WriteString(text)
		if err := sendEvent("response.output_text.delta", map[string]any{
			"item_id":       textItemID,
			"output_index":  textOutputIndex,
			"content_index": 0,
			"delta":         text,
			"logprobs":      []any{},
		}); err != nil {
			return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
		}
	}
	if !finishTextItem() {
		return nil, streamErr
	}
	if !finishToolItems() {
		return nil, streamErr
	}

	if usage == nil || usage.TotalTokens == 0 {
		usage = service.ResponseText2Usage(c, usageText.String(), info.UpstreamModelName, info.GetEstimatePromptTokens())
	}

	output := make([]map[string]any, nextOutputIndex)
	if textItemStarted {
		output[textOutputIndex] = responsesCompatMessageOutput(textItemID, "completed", outputText.String())
	}
	for _, state := range toolOrder {
		output[state.OutputIndex] = responsesCompatToolOutput(state, "completed")
	}
	compactedOutput := make([]map[string]any, 0, len(output))
	for _, item := range output {
		if item != nil {
			compactedOutput = append(compactedOutput, item)
		}
	}

	if err := sendEvent("response.completed", map[string]any{
		"response": responsesCompatResponseObject(responseID, createdAt, model, "completed", compactedOutput, usage),
	}); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	return usage, nil
}

func responsesCompatResponseID(c *gin.Context) string {
	logID := c.GetString(common.RequestIdKey)
	if logID == "" {
		return fmt.Sprintf("resp_%d", time.Now().UnixNano())
	}
	return "resp_" + logID
}

func responsesCompatResponseObject(id string, createdAt int64, model string, status string, output []map[string]any, usage *dto.Usage) map[string]any {
	if output == nil {
		output = []map[string]any{}
	}
	var completedAt any
	if status == "completed" {
		completedAtUnix := time.Now().Unix()
		if completedAtUnix < createdAt {
			completedAtUnix = createdAt
		}
		completedAt = completedAtUnix
	}
	resp := map[string]any{
		"id":                   id,
		"object":               "response",
		"created_at":           createdAt,
		"status":               status,
		"background":           false,
		"completed_at":         completedAt,
		"error":                nil,
		"incomplete_details":   nil,
		"instructions":         nil,
		"max_output_tokens":    nil,
		"max_tool_calls":       nil,
		"model":                model,
		"output":               output,
		"parallel_tool_calls":  true,
		"previous_response_id": nil,
		"reasoning": map[string]any{
			"effort":  nil,
			"summary": nil,
		},
		"store":       false,
		"temperature": 1.0,
		"text": map[string]any{
			"format": map[string]any{
				"type": "text",
			},
		},
		"tool_choice": "auto",
		"tools":       []any{},
		"top_p":       1.0,
		"truncation":  "disabled",
		"user":        nil,
		"metadata":    map[string]any{},
	}
	if usage != nil {
		resp["usage"] = usage
	} else {
		resp["usage"] = nil
	}
	return resp
}

func responsesCompatMessageOutput(id string, status string, text string) map[string]any {
	return map[string]any{
		"id":     id,
		"type":   "message",
		"status": status,
		"role":   "assistant",
		"phase":  "final_answer",
		"content": []map[string]any{
			{
				"type":        "output_text",
				"text":        text,
				"annotations": []any{},
				"logprobs":    []any{},
			},
		},
	}
}

func responsesCompatToolOutput(state *responsesCompatToolState, status string) map[string]any {
	itemType := state.Type
	if itemType == "" {
		itemType = "function_call"
	}
	out := map[string]any{
		"id":      state.ItemID,
		"type":    itemType,
		"status":  status,
		"call_id": state.CallID,
		"name":    state.Name,
	}
	if itemType == "custom_tool_call" {
		out["input"] = responsesCompatCustomToolInput(state.Arguments.String())
	} else {
		out["arguments"] = state.Arguments.String()
	}
	return out
}

func responsesCompatCustomToolInput(arguments string) any {
	var object map[string]any
	if err := common.Unmarshal([]byte(arguments), &object); err == nil {
		if input, ok := object["input"].(string); ok {
			return input
		}
	}
	return arguments
}

func responsesCompatToolMappings(c *gin.Context) map[string]dto.ResponsesCompatToolMapping {
	if c == nil {
		return nil
	}
	value, exists := c.Get(dto.ContextKeyResponsesCompatToolMappings)
	if !exists {
		return nil
	}
	mappings, ok := value.(map[string]dto.ResponsesCompatToolMapping)
	if !ok {
		return nil
	}
	return mappings
}

func responsesCompatApplyToolMapping(state *responsesCompatToolState, safeName string, mappings map[string]dto.ResponsesCompatToolMapping) {
	if state == nil {
		return
	}
	state.Type = "function_call"
	state.Name = safeName
	if len(mappings) == 0 {
		return
	}
	mapping, ok := mappings[safeName]
	if !ok {
		return
	}
	if mapping.OriginalName != "" {
		state.Name = mapping.OriginalName
	}
	if mapping.Wrapped {
		state.Type = "custom_tool_call"
		if strings.HasPrefix(state.ItemID, "fc_") {
			state.ItemID = "ctc_" + strings.TrimPrefix(state.ItemID, "fc_")
		}
	}
}

func responsesCompatUsageFromChat(usage *dto.Usage) *dto.Usage {
	if usage == nil {
		return &dto.Usage{}
	}
	out := *usage
	if out.InputTokens == 0 {
		out.InputTokens = out.PromptTokens
	}
	if out.OutputTokens == 0 {
		out.OutputTokens = out.CompletionTokens
	}
	if out.PromptTokens == 0 {
		out.PromptTokens = out.InputTokens
	}
	if out.CompletionTokens == 0 {
		out.CompletionTokens = out.OutputTokens
	}
	if out.TotalTokens == 0 {
		out.TotalTokens = out.InputTokens + out.OutputTokens
	}
	if out.InputTokensDetails == nil {
		details := out.PromptTokensDetails
		out.InputTokensDetails = &details
	}
	return &out
}

func sendResponsesCompatEvent(c *gin.Context, eventType string, payload map[string]any, sequenceNumber ...*int) error {
	if payload == nil {
		payload = map[string]any{}
	}
	payload["type"] = eventType
	if len(sequenceNumber) > 0 && sequenceNumber[0] != nil {
		seq := sequenceNumber[0]
		payload["sequence_number"] = *seq
		*seq = *seq + 1
	}
	data, err := common.Marshal(payload)
	if err != nil {
		return err
	}
	c.Render(-1, common.CustomEvent{Data: fmt.Sprintf("event: %s\n", eventType)})
	c.Render(-1, common.CustomEvent{Data: "data: " + string(data)})
	return helper.FlushWriter(c)
}
