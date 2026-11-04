package controller

import (
	"errors"

	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

func Playground(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAI)
}

func ImagePlayground(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAIImage)
}

func VideoPlayground(c *gin.Context) {
	if !setupPlaygroundTokenContext(c, types.RelayFormatTask) {
		return
	}
	RelayTask(c)
}

func VideoPlaygroundFetch(c *gin.Context) {
	if !setupPlaygroundTokenContext(c, types.RelayFormatTask) {
		return
	}
	RelayTaskFetch(c)
}

func playgroundRelay(c *gin.Context, relayFormat types.RelayFormat) {
	if !setupPlaygroundTokenContext(c, relayFormat) {
		return
	}

	Relay(c, relayFormat)
}

func setupPlaygroundTokenContext(c *gin.Context, relayFormat types.RelayFormat) bool {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.StatusCode, gin.H{
				"error": newAPIError.ToOpenAIError(),
			})
		}
	}()

	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		newAPIError = types.NewError(errors.New("暂不支持使用 access token"), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return false
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, relayFormat, nil, nil)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		return false
	}

	userId := c.GetInt("id")

	// Write user context to ensure acceptUnsetRatio is available
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return false
	}
	userCache.WriteContext(c)

	tempToken := &model.Token{
		UserId: userId,
		// 操练场的请求没有真实令牌，这里伪造一个仅用于日志与性能指标的归属。
		// 名称与「清荫」系列入口保持一致；分组信息在日志的分组列已有，不再重复。
		Name:  "清荫",
		Group: relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)
	return newAPIError == nil
}
