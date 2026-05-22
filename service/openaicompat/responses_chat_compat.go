package openaicompat

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

func ResponsesRequestToChatCompletionsRequest(req *dto.OpenAIResponsesRequest) (*dto.GeneralOpenAIRequest, error) {
	if req == nil {
		return nil, errors.New("request is nil")
	}
	if req.Model == "" {
		return nil, errors.New("model is required")
	}

	messages := make([]dto.Message, 0)
	if instruction := rawMessageText(req.Instructions); strings.TrimSpace(instruction) != "" {
		messages = append(messages, dto.Message{
			Role:    "system",
			Content: instruction,
		})
	}

	inputMessages, err := responsesInputToChatMessages(req.Input)
	if err != nil {
		return nil, err
	}
	messages = append(messages, inputMessages...)
	messages = collapseSystemMessages(messages)

	chatReq := &dto.GeneralOpenAIRequest{
		Model:            req.Model,
		Messages:         messages,
		Stream:           req.Stream,
		StreamOptions:    req.StreamOptions,
		MaxTokens:        req.MaxOutputTokens,
		Temperature:      req.Temperature,
		TopP:             req.TopP,
		Tools:            responsesToolsToChatTools(req.Tools),
		ToolChoice:       responsesToolChoiceToChatToolChoice(req.ToolChoice),
		ResponseFormat:   responsesTextToChatResponseFormat(req.Text),
		User:             req.User,
		Store:            req.Store,
		ServiceTier:      rawMessageString(req.ServiceTier),
		Metadata:         req.Metadata,
		SafetyIdentifier: req.SafetyIdentifier,
	}

	if req.Reasoning != nil {
		chatReq.ReasoningEffort = req.Reasoning.Effort
	}
	if len(req.ParallelToolCalls) > 0 {
		var parallel bool
		if err := common.Unmarshal(req.ParallelToolCalls, &parallel); err == nil {
			chatReq.ParallelTooCalls = &parallel
		}
	}
	if promptCacheKey := rawMessageText(req.PromptCacheKey); promptCacheKey != "" {
		chatReq.PromptCacheKey = promptCacheKey
	}
	if len(req.PromptCacheRetention) > 0 {
		chatReq.PromptCacheRetention = req.PromptCacheRetention
	}

	return chatReq, nil
}

func collapseSystemMessages(messages []dto.Message) []dto.Message {
	if len(messages) <= 1 {
		return messages
	}

	collapsed := make([]dto.Message, 0, len(messages))
	var systemBuilder strings.Builder
	for _, message := range messages {
		if strings.EqualFold(strings.TrimSpace(message.Role), "system") {
			text := strings.TrimSpace(message.StringContent())
			if text == "" && message.Content != nil {
				text = strings.TrimSpace(interfaceText(message.Content))
			}
			if text == "" {
				continue
			}
			if systemBuilder.Len() > 0 {
				systemBuilder.WriteString("\n\n")
			}
			systemBuilder.WriteString(text)
			continue
		}
		collapsed = append(collapsed, message)
	}

	if systemBuilder.Len() == 0 {
		return collapsed
	}
	systemMessage := dto.Message{
		Role:    "system",
		Content: systemBuilder.String(),
	}
	return append([]dto.Message{systemMessage}, collapsed...)
}

func ChatCompletionsResponseToResponsesResponse(resp *dto.OpenAITextResponse, id string) (*dto.OpenAIResponsesResponse, *dto.Usage, error) {
	if resp == nil {
		return nil, nil, errors.New("response is nil")
	}

	usage := chatUsageToResponsesUsage(resp.Usage)
	output := make([]dto.ResponsesOutput, 0, len(resp.Choices))

	for choiceIndex, choice := range resp.Choices {
		toolCalls := choice.Message.ParseToolCalls()
		if len(toolCalls) > 0 {
			for toolIndex, toolCall := range toolCalls {
				callID := strings.TrimSpace(toolCall.ID)
				if callID == "" {
					callID = fmt.Sprintf("call_%d_%d", choiceIndex, toolIndex)
				}
				argumentsRaw, _ := common.Marshal(toolCall.Function.Arguments)
				output = append(output, dto.ResponsesOutput{
					Type:      "function_call",
					ID:        "fc_" + callID,
					Status:    "completed",
					CallId:    callID,
					Name:      toolCall.Function.Name,
					Arguments: argumentsRaw,
				})
			}
			continue
		}

		text := choice.Message.StringContent()
		if text == "" {
			text = choice.Message.GetReasoningContent()
		}
		if text == "" && choice.Message.Content == nil {
			continue
		}
		output = append(output, dto.ResponsesOutput{
			Type:   "message",
			ID:     fmt.Sprintf("msg_%d", choiceIndex),
			Status: "completed",
			Role:   "assistant",
			Content: []dto.ResponsesOutputContent{
				{
					Type: "output_text",
					Text: text,
				},
			},
		})
	}

	out := &dto.OpenAIResponsesResponse{
		ID:        id,
		Object:    "response",
		CreatedAt: chatCreatedAt(resp.Created),
		Status:    rawMessageString("completed"),
		Model:     resp.Model,
		Output:    output,
		Usage:     usage,
	}
	return out, usage, nil
}

func responsesInputToChatMessages(input json.RawMessage) ([]dto.Message, error) {
	if len(input) == 0 {
		return nil, nil
	}
	inputType := common.GetJsonType(input)
	if inputType == "null" {
		return nil, nil
	}
	if inputType == "string" {
		var text string
		if err := common.Unmarshal(input, &text); err != nil {
			return nil, err
		}
		return []dto.Message{{Role: "user", Content: text}}, nil
	}

	var items []map[string]any
	if err := common.Unmarshal(input, &items); err != nil {
		return nil, err
	}

	messages := make([]dto.Message, 0, len(items))
	knownToolCallIDs := make(map[string]struct{})
	for _, item := range items {
		itemType := common.Interface2String(item["type"])
		switch itemType {
		case "function_call_output":
			callID := common.Interface2String(item["call_id"])
			output := item["output"]
			if _, ok := knownToolCallIDs[callID]; !ok || callID == "" {
				messages = append(messages, dto.Message{
					Role:    "user",
					Content: functionCallOutputText(callID, output),
				})
				continue
			}
			messages = append(messages, dto.Message{
				Role:       "tool",
				ToolCallId: callID,
				Content:    interfaceText(output),
			})
		case "function_call":
			callID := common.Interface2String(item["call_id"])
			if callID == "" {
				callID = common.Interface2String(item["id"])
			}
			toolCall := dto.ToolCallRequest{
				ID:   callID,
				Type: "function",
				Function: dto.FunctionRequest{
					Name:      common.Interface2String(item["name"]),
					Arguments: rawArgumentString(item["arguments"]),
				},
			}
			msg := dto.Message{Role: "assistant", Content: ""}
			msg.SetToolCalls([]dto.ToolCallRequest{toolCall})
			messages = append(messages, msg)
			if callID != "" {
				knownToolCallIDs[callID] = struct{}{}
			}
		case "input_text":
			messages = append(messages, dto.Message{
				Role:    "user",
				Content: common.Interface2String(item["text"]),
			})
		default:
			role := normalizeResponsesChatRole(common.Interface2String(item["role"]))
			if role == "" {
				role = "user"
			}
			content := responsesContentToChatContent(item["content"], role)
			messages = append(messages, dto.Message{
				Role:    role,
				Content: content,
			})
		}
	}
	return messages, nil
}

func functionCallOutputText(callID string, output any) string {
	text := interfaceText(output)
	if callID == "" {
		return "Tool output:\n" + text
	}
	return "Tool output (" + callID + "):\n" + text
}

func normalizeResponsesChatRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "developer":
		return "system"
	default:
		return role
	}
}

func responsesContentToChatContent(content any, role string) any {
	switch v := content.(type) {
	case nil:
		return ""
	case string:
		return v
	case []any:
		parts := make([]dto.MediaContent, 0, len(v))
		textOnly := true
		var textBuilder strings.Builder
		for _, partAny := range v {
			part, ok := partAny.(map[string]any)
			if !ok {
				continue
			}
			media, isText := responsesContentPartToChatPart(part, role)
			if isText {
				textBuilder.WriteString(media.Text)
			} else {
				textOnly = false
			}
			parts = append(parts, media)
		}
		if textOnly {
			return textBuilder.String()
		}
		return parts
	default:
		return interfaceText(v)
	}
}

func responsesContentPartToChatPart(part map[string]any, role string) (dto.MediaContent, bool) {
	partType := common.Interface2String(part["type"])
	switch partType {
	case "input_text", "output_text":
		return dto.MediaContent{
			Type: dto.ContentTypeText,
			Text: common.Interface2String(part["text"]),
		}, true
	case "input_image":
		imageURL := part["image_url"]
		if imageURL == nil {
			imageURL = part["file_id"]
		}
		return dto.MediaContent{
			Type:     dto.ContentTypeImageURL,
			ImageUrl: imageURL,
		}, false
	case "input_audio":
		return dto.MediaContent{
			Type:       dto.ContentTypeInputAudio,
			InputAudio: part["input_audio"],
		}, false
	case "input_file":
		file := part["file"]
		if file == nil {
			file = map[string]any{
				"file_id":   part["file_id"],
				"file_data": part["file_data"],
				"filename":  part["filename"],
			}
		}
		return dto.MediaContent{
			Type: dto.ContentTypeFile,
			File: file,
		}, false
	case "input_video":
		return dto.MediaContent{
			Type:     dto.ContentTypeVideoUrl,
			VideoUrl: part["video_url"],
		}, false
	default:
		if role == "assistant" {
			return dto.MediaContent{Type: dto.ContentTypeText, Text: interfaceText(part)}, true
		}
		return dto.MediaContent{Type: dto.ContentTypeText, Text: interfaceText(part)}, true
	}
}

func responsesToolsToChatTools(raw json.RawMessage) []dto.ToolCallRequest {
	if len(raw) == 0 {
		return nil
	}
	var tools []map[string]any
	if err := common.Unmarshal(raw, &tools); err != nil {
		return nil
	}

	chatTools := make([]dto.ToolCallRequest, 0, len(tools))
	for _, tool := range tools {
		if common.Interface2String(tool["type"]) != "function" {
			continue
		}
		name := common.Interface2String(tool["name"])
		description := common.Interface2String(tool["description"])
		parameters := tool["parameters"]
		if fn, ok := tool["function"].(map[string]any); ok {
			if name == "" {
				name = common.Interface2String(fn["name"])
			}
			if description == "" {
				description = common.Interface2String(fn["description"])
			}
			if parameters == nil {
				parameters = fn["parameters"]
			}
		}
		if name == "" {
			continue
		}
		chatTools = append(chatTools, dto.ToolCallRequest{
			Type: "function",
			Function: dto.FunctionRequest{
				Name:        name,
				Description: description,
				Parameters:  parameters,
			},
		})
	}
	return chatTools
}

func responsesToolChoiceToChatToolChoice(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	if common.GetJsonType(raw) == "string" {
		var choice string
		if err := common.Unmarshal(raw, &choice); err == nil {
			return choice
		}
		return nil
	}
	var choice map[string]any
	if err := common.Unmarshal(raw, &choice); err != nil {
		return nil
	}
	if common.Interface2String(choice["type"]) != "function" {
		return choice
	}
	name := common.Interface2String(choice["name"])
	if name == "" {
		if fn, ok := choice["function"].(map[string]any); ok {
			name = common.Interface2String(fn["name"])
		}
	}
	if name == "" {
		return choice
	}
	return map[string]any{
		"type": "function",
		"function": map[string]any{
			"name": name,
		},
	}
}

func responsesTextToChatResponseFormat(raw json.RawMessage) *dto.ResponseFormat {
	if len(raw) == 0 {
		return nil
	}
	var text map[string]any
	if err := common.Unmarshal(raw, &text); err != nil {
		return nil
	}
	format, ok := text["format"].(map[string]any)
	if !ok {
		format = text
	}
	formatType := common.Interface2String(format["type"])
	if formatType == "" {
		return nil
	}
	responseFormat := &dto.ResponseFormat{Type: formatType}
	if formatType == "json_schema" {
		schema := make(map[string]any, len(format))
		for key, value := range format {
			if key == "type" {
				continue
			}
			schema[key] = value
		}
		if nested, ok := schema["json_schema"].(map[string]any); ok {
			schema = nested
		}
		responseFormat.JsonSchema, _ = common.Marshal(schema)
	}
	return responseFormat
}

func chatUsageToResponsesUsage(usage dto.Usage) *dto.Usage {
	if usage.InputTokens == 0 {
		usage.InputTokens = usage.PromptTokens
	}
	if usage.OutputTokens == 0 {
		usage.OutputTokens = usage.CompletionTokens
	}
	if usage.TotalTokens == 0 {
		usage.TotalTokens = usage.InputTokens + usage.OutputTokens
	}
	if usage.PromptTokens == 0 {
		usage.PromptTokens = usage.InputTokens
	}
	if usage.CompletionTokens == 0 {
		usage.CompletionTokens = usage.OutputTokens
	}
	if usage.InputTokensDetails == nil {
		details := usage.PromptTokensDetails
		usage.InputTokensDetails = &details
	}
	return &usage
}

func chatCreatedAt(created any) int {
	switch v := created.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		i, _ := strconv.ParseInt(v.String(), 10, 64)
		return int(i)
	case string:
		i, _ := strconv.ParseInt(v, 10, 64)
		return int(i)
	default:
		return int(time.Now().Unix())
	}
}

func rawMessageText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	rawType := common.GetJsonType(raw)
	if rawType == "null" {
		return ""
	}
	if rawType == "string" {
		var text string
		if err := common.Unmarshal(raw, &text); err == nil {
			return text
		}
	}
	return string(raw)
}

func rawMessageString(value string) json.RawMessage {
	if value == "" {
		return nil
	}
	raw, _ := common.Marshal(value)
	return raw
}

func interfaceText(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	default:
		raw, err := common.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(raw)
	}
}

func rawArgumentString(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	default:
		raw, err := common.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(raw)
	}
}
