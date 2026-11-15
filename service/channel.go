package service

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// RelayErrorSource tells where a failed attempt went wrong: "channel" for the
// channel's own key or config (channel:* codes), "transport" when the
// upstream could not be reached, "local" for an error new-api raised itself
// before or without an upstream answer, and "upstream" for an upstream error
// response. Adaptors also report what the upstream answered with new-api
// error values, so the response codes count as upstream, and a local error
// that wraps another relay error takes that error's source.
func RelayErrorSource(err *types.NewAPIError) string {
	switch {
	case types.IsChannelError(err):
		return "channel"
	case err.GetErrorCode() == types.ErrorCodeDoRequestFailed:
		return "transport"
	case err.GetErrorType() != types.ErrorTypeNewAPIError:
		return "upstream"
	}
	switch err.GetErrorCode() {
	case types.ErrorCodeReadResponseBodyFailed, types.ErrorCodeBadResponseStatusCode, types.ErrorCodeBadResponse,
		types.ErrorCodeBadResponseBody, types.ErrorCodeEmptyResponse, types.ErrorCodeAwsInvokeError:
		return "upstream"
	}
	var inner *types.NewAPIError
	if errors.As(err.Unwrap(), &inner) && inner != err {
		return RelayErrorSource(inner)
	}
	return "local"
}

func formatNotifyType(channelId int, status int) string {
	return fmt.Sprintf("%s_%d_%d", dto.NotifyTypeChannelUpdate, channelId, status)
}

// disable & notify
func DisableChannel(channelError types.ChannelError, reason string) {
	common.SysLog(fmt.Sprintf("通道「%s」（#%d）发生错误，准备禁用，原因：%s", channelError.ChannelName, channelError.ChannelId, common.LocalLogPreview(reason)))

	// 检查是否启用自动禁用功能
	if !channelError.AutoBan {
		common.SysLog(fmt.Sprintf("通道「%s」（#%d）未启用自动禁用功能，跳过禁用操作", channelError.ChannelName, channelError.ChannelId))
		return
	}

	success := model.UpdateChannelStatus(channelError.ChannelId, channelError.UsingKey, common.ChannelStatusAutoDisabled, reason)
	if success {
		subject := fmt.Sprintf("通道「%s」（#%d）已被禁用", channelError.ChannelName, channelError.ChannelId)
		content := fmt.Sprintf("通道「%s」（#%d）已被禁用，原因：%s", channelError.ChannelName, channelError.ChannelId, reason)
		NotifyRootUser(formatNotifyType(channelError.ChannelId, common.ChannelStatusAutoDisabled), subject, content)
	}
}

func EnableChannel(channelId int, usingKey string, channelName string) {
	success := model.UpdateChannelStatus(channelId, usingKey, common.ChannelStatusEnabled, "")
	if success {
		subject := fmt.Sprintf("通道「%s」（#%d）已被启用", channelName, channelId)
		content := fmt.Sprintf("通道「%s」（#%d）已被启用", channelName, channelId)
		NotifyRootUser(formatNotifyType(channelId, common.ChannelStatusEnabled), subject, content)
	}
}

func ShouldDisableChannel(err *types.NewAPIError) bool {
	if !common.AutomaticDisableChannelEnabled {
		return false
	}
	if err == nil {
		return false
	}
	// Channel key and config errors fail for every request, so they disable.
	// Errors new-api raised itself never do: the request may not have reached
	// the upstream, and their message can carry client input that would
	// otherwise match a disable keyword.
	switch RelayErrorSource(err) {
	case "channel":
		return true
	case "local":
		return false
	}
	if types.IsSkipRetryError(err) {
		return false
	}
	if operation_setting.ShouldDisableByStatusCode(err.StatusCode) {
		return true
	}

	lowerMessage := strings.ToLower(err.Error())
	search, _ := AcSearch(lowerMessage, operation_setting.AutomaticDisableKeywords, true)
	return search
}

func ShouldEnableChannel(newAPIError *types.NewAPIError, status int) bool {
	if !common.AutomaticEnableChannelEnabled {
		return false
	}
	if newAPIError != nil {
		return false
	}
	if status != common.ChannelStatusAutoDisabled {
		return false
	}
	return true
}

// ShouldEnableMultiKey is the key-level counterpart of ShouldEnableChannel: a
// single key of a multi-key channel may return to rotation once a probe reaches
// upstream with it, even though the channel-level status never left Enabled.
func ShouldEnableMultiKey(newAPIError *types.NewAPIError, keyStatus int) bool {
	if !common.AutomaticEnableChannelEnabled {
		return false
	}
	if newAPIError != nil {
		return false
	}
	return keyStatus == common.ChannelStatusAutoDisabled
}
