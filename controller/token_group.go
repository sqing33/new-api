package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// tokenGroupRequest 是新建/重命名分组的请求体。
type tokenGroupRequest struct {
	Name string `json:"name"`
}

// respondTokenGroupError 把 model 层的分组错误翻译成用户可读的提示。
func respondTokenGroupError(c *gin.Context, err error, groupName string) {
	switch {
	case errors.Is(err, model.ErrTokenGroupNameEmpty):
		common.ApiErrorI18n(c, i18n.MsgTokenGroupNameEmpty)
	case errors.Is(err, model.ErrTokenGroupNameTooLong):
		common.ApiErrorI18n(c, i18n.MsgTokenGroupNameTooLong)
	case errors.Is(err, model.ErrTokenGroupNameInvalid):
		common.ApiErrorI18n(c, i18n.MsgTokenGroupNameInvalid)
	case errors.Is(err, model.ErrTokenGroupNameExists):
		common.ApiErrorI18n(c, i18n.MsgTokenGroupNameExists, map[string]any{"Name": groupName})
	case errors.Is(err, model.ErrTokenGroupNotFound):
		common.ApiErrorI18n(c, i18n.MsgTokenGroupNotFound)
	default:
		common.ApiError(c, err)
	}
}

// GetTokenGroups 返回当前用户的分组目录，含每个分组下的令牌数。
func GetTokenGroups(c *gin.Context) {
	groups, err := model.ListUserTokenGroups(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, groups)
}

// CreateTokenGroup 新建一个分组。分组可以暂时没有任何令牌。
func CreateTokenGroup(c *gin.Context) {
	request := tokenGroupRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	group, err := model.CreateUserTokenGroup(c.GetInt("id"), request.Name)
	if err != nil {
		respondTokenGroupError(c, err, request.Name)
		return
	}
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, group)
}

// UpdateTokenGroup 重命名分组，并把该用户令牌上的分组名一起改掉。
func UpdateTokenGroup(c *gin.Context) {
	groupId, err := strconv.Atoi(c.Param("id"))
	if err != nil || groupId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidId)
		return
	}
	request := tokenGroupRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	group, err := model.RenameUserTokenGroup(c.GetInt("id"), groupId, request.Name)
	if err != nil {
		respondTokenGroupError(c, err, request.Name)
		return
	}
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, group)
}

// DeleteTokenGroup 删除分组，该分组下的令牌回到「未分组」。
func DeleteTokenGroup(c *gin.Context) {
	groupId, err := strconv.Atoi(c.Param("id"))
	if err != nil || groupId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidId)
		return
	}
	if err := model.DeleteUserTokenGroup(c.GetInt("id"), groupId); err != nil {
		respondTokenGroupError(c, err, c.Param("id"))
		return
	}
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}
