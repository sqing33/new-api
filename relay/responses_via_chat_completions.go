package relay

import (
	"bytes"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaykitdto "github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relay/channel"
	openaichannel "github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"
	relaykittypes "github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

func responsesViaChatCompletions(c *gin.Context, info *relaycommon.RelayInfo, adaptor channel.Adaptor, request *relaykitdto.OpenAIResponsesRequest) (*relaykitdto.Usage, *relaykittypes.NewAPIError) {
	toolMode := info.ChannelOtherSettings.ResponsesCompatToolMode
	if toolMode == "" {
		toolMode = relaykitdto.ResponsesCompatToolModeWrapNonFunction
	}
	chatReq, toolMappings, err := service.ResponsesRequestToChatCompletionsRequestWithToolMode(request, toolMode)
	if err != nil {
		return nil, relaykittypes.NewErrorWithStatusCode(err, relaykittypes.ErrorCodeInvalidRequest, http.StatusBadRequest, relaykittypes.ErrOptionWithSkipRetry())
	}
	if len(toolMappings) > 0 {
		c.Set(relaykitdto.ContextKeyResponsesCompatToolMappings, toolMappings)
	}
	info.AppendRequestConversion(relaykittypes.RelayFormatOpenAI)

	savedRelayMode := info.RelayMode
	savedRequestURLPath := info.RequestURLPath
	defer func() {
		info.RelayMode = savedRelayMode
		info.RequestURLPath = savedRequestURLPath
	}()

	info.RelayMode = relayconstant.RelayModeChatCompletions
	info.RequestURLPath = "/v1/chat/completions"

	convertedRequest, err := adaptor.ConvertOpenAIRequest(c, info, chatReq)
	if err != nil {
		return nil, relaykittypes.NewError(err, relaykittypes.ErrorCodeConvertRequestFailed, relaykittypes.ErrOptionWithSkipRetry())
	}
	relaycommon.AppendRequestConversionFromRequest(info, convertedRequest)

	jsonData, err := common.Marshal(convertedRequest)
	if err != nil {
		return nil, relaykittypes.NewError(err, relaykittypes.ErrorCodeConvertRequestFailed, relaykittypes.ErrOptionWithSkipRetry())
	}

	jsonData, err = relaycommon.RemoveDisabledFields(jsonData, info.ChannelOtherSettings, info.ChannelSetting.PassThroughBodyEnabled)
	if err != nil {
		return nil, relaykittypes.NewError(err, relaykittypes.ErrorCodeConvertRequestFailed, relaykittypes.ErrOptionWithSkipRetry())
	}

	if len(info.ParamOverride) > 0 {
		jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
		if err != nil {
			return nil, newAPIErrorFromParamOverride(err)
		}
	}

	if common.DebugEnabled {
		println("responses compat chat requestBody: ", string(jsonData))
	}

	resp, err := adaptor.DoRequest(c, info, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, relaykittypes.NewOpenAIError(err, relaykittypes.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}
	if resp == nil {
		return nil, relaykittypes.NewOpenAIError(nil, relaykittypes.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	statusCodeMappingStr := c.GetString("status_code_mapping")
	httpResp := resp.(*http.Response)
	info.IsStream = info.IsStream || strings.HasPrefix(httpResp.Header.Get("Content-Type"), "text/event-stream")
	if httpResp.StatusCode != http.StatusOK {
		newApiErr := service.RelayErrorHandler(c.Request.Context(), httpResp, false)
		service.ResetStatusCode(newApiErr, statusCodeMappingStr)
		return nil, newApiErr
	}

	var usage *relaykitdto.Usage
	var newApiErr *relaykittypes.NewAPIError
	if info.IsStream {
		usage, newApiErr = openaichannel.OaiChatToResponsesStreamHandler(c, info, httpResp)
	} else {
		usage, newApiErr = openaichannel.OaiChatToResponsesHandler(c, info, httpResp)
	}
	if newApiErr != nil {
		service.ResetStatusCode(newApiErr, statusCodeMappingStr)
		return nil, newApiErr
	}
	return usage, nil
}
