package service

import (
	relaykitdto "github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service/openaicompat"
)

func ChatCompletionsRequestToResponsesRequest(req *relaykitdto.GeneralOpenAIRequest) (*relaykitdto.OpenAIResponsesRequest, error) {
	return openaicompat.ChatCompletionsRequestToResponsesRequest(req)
}

func ResponsesRequestToChatCompletionsRequest(req *relaykitdto.OpenAIResponsesRequest) (*relaykitdto.GeneralOpenAIRequest, error) {
	return openaicompat.ResponsesRequestToChatCompletionsRequest(req)
}

func ResponsesRequestToChatCompletionsRequestWithToolMode(req *relaykitdto.OpenAIResponsesRequest, toolMode string) (*relaykitdto.GeneralOpenAIRequest, map[string]relaykitdto.ResponsesCompatToolMapping, error) {
	return openaicompat.ResponsesRequestToChatCompletionsRequestWithToolMode(req, toolMode)
}

func ResponsesResponseToChatCompletionsResponse(resp *relaykitdto.OpenAIResponsesResponse, id string) (*relaykitdto.OpenAITextResponse, *relaykitdto.Usage, error) {
	return openaicompat.ResponsesResponseToChatCompletionsResponse(resp, id)
}

func ChatCompletionsResponseToResponsesResponse(resp *relaykitdto.OpenAITextResponse, id string) (*relaykitdto.OpenAIResponsesResponse, *relaykitdto.Usage, error) {
	return openaicompat.ChatCompletionsResponseToResponsesResponse(resp, id)
}

func ChatCompletionsResponseToResponsesResponseWithToolMappings(resp *relaykitdto.OpenAITextResponse, id string, mappings map[string]relaykitdto.ResponsesCompatToolMapping) (*relaykitdto.OpenAIResponsesResponse, *relaykitdto.Usage, error) {
	return openaicompat.ChatCompletionsResponseToResponsesResponseWithToolMappings(resp, id, mappings)
}

func ExtractOutputTextFromResponses(resp *relaykitdto.OpenAIResponsesResponse) string {
	return openaicompat.ExtractOutputTextFromResponses(resp)
}
