package service

import (
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/relayconvert"
)

func ChatCompletionsRequestToResponsesRequest(req *dto.GeneralOpenAIRequest) (*dto.OpenAIResponsesRequest, error) {
	return relayconvert.ChatCompletionsRequestToResponsesRequest(req)
}

func ResponsesRequestToChatCompletionsRequest(req *dto.OpenAIResponsesRequest) (*dto.GeneralOpenAIRequest, error) {
	return relayconvert.ResponsesRequestToChatCompletionsRequest(req)
}

func ChatCompletionsResponseToResponsesResponse(resp *dto.OpenAITextResponse, id string) (*dto.OpenAIResponsesResponse, *dto.Usage, error) {
	return relayconvert.ChatCompletionsResponseToResponsesResponse(resp, id)
}

func ResponsesRequestToChatCompletionsRequest(req *dto.OpenAIResponsesRequest) (*dto.GeneralOpenAIRequest, error) {
	return openaicompat.ResponsesRequestToChatCompletionsRequest(req)
}

func ResponsesRequestToChatCompletionsRequestWithToolMode(req *dto.OpenAIResponsesRequest, toolMode string) (*dto.GeneralOpenAIRequest, map[string]dto.ResponsesCompatToolMapping, error) {
	return openaicompat.ResponsesRequestToChatCompletionsRequestWithToolMode(req, toolMode)
}

func ResponsesResponseToChatCompletionsResponse(resp *dto.OpenAIResponsesResponse, id string) (*dto.OpenAITextResponse, *dto.Usage, error) {
	return relayconvert.ResponsesResponseToChatCompletionsResponse(resp, id)
}

func ResponsesFinishReasonFromStatus(resp *dto.OpenAIResponsesResponse) (string, bool) {
	return relayconvert.ResponsesFinishReasonFromStatus(resp)
}

func ChatCompletionsResponseToResponsesResponse(resp *dto.OpenAITextResponse, id string) (*dto.OpenAIResponsesResponse, *dto.Usage, error) {
	return openaicompat.ChatCompletionsResponseToResponsesResponse(resp, id)
}

func ChatCompletionsResponseToResponsesResponseWithToolMappings(resp *dto.OpenAITextResponse, id string, mappings map[string]dto.ResponsesCompatToolMapping) (*dto.OpenAIResponsesResponse, *dto.Usage, error) {
	return openaicompat.ChatCompletionsResponseToResponsesResponseWithToolMappings(resp, id, mappings)
}

func ExtractOutputTextFromResponses(resp *dto.OpenAIResponsesResponse) string {
	return relayconvert.ExtractOutputTextFromResponses(resp)
}
