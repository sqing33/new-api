package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

func GetPerfMetricsSummary(c *gin.Context) {
	hours := 24
	if rawHours := c.Query("hours"); rawHours != "" {
		if parsed, err := strconv.Atoi(rawHours); err == nil {
			hours = parsed
		}
	}

	activeGroups := append(lo.Keys(ratio_setting.GetGroupRatioCopy()), "auto")
	result, err := perfmetrics.QuerySummaryAll(hours, activeGroups)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

func GetPerfMetrics(c *gin.Context) {
	modelName := c.Query("model")
	if modelName == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "model is required",
		})
		return
	}

	hours := 24
	if rawHours := c.Query("hours"); rawHours != "" {
		if parsed, err := strconv.Atoi(rawHours); err == nil {
			hours = parsed
		}
	}

	result, err := perfmetrics.Query(perfmetrics.QueryParams{
		Model: modelName,
		Group: c.Query("group"),
		Hours: hours,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	result.Groups = filterActiveGroups(result.Groups)
	// 渠道名称属于运营侧信息,只下发给管理员;普通用户保持分组视图。
	if c.GetInt("role") < common.RoleAdminUser {
		result.Channels = nil
	}
	// 令牌名称同理:管理员看全部用户的令牌,普通用户只看自己的。
	result.Tokens = scopePerfTokenResults(result.Tokens, c.GetInt("role"), c.GetInt("id"))

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// scopePerfTokenResults 下发令牌维度指标前做权限收敛:
// 管理员保留全部行并补全真实令牌名与归属用户名;普通用户只保留自己的令牌,
// 名称为空的历史行统一显示为「未知令牌」。
func scopePerfTokenResults(tokens []perfmetrics.TokenResult, role int, userId int) []perfmetrics.TokenResult {
	if len(tokens) == 0 {
		return tokens
	}

	ids := make([]int, 0, len(tokens))
	for _, token := range tokens {
		if token.TokenId > 0 {
			ids = append(ids, token.TokenId)
		}
	}
	ownerships, err := model.GetTokenOwnerships(ids)
	if err != nil {
		// 查不到归属时不能把别人的令牌名泄露出去:整段令牌视图降级为隐藏。
		common.SysError("failed to load token ownerships for perf metrics: " + err.Error())
		return nil
	}

	isAdmin := role >= common.RoleAdminUser
	scoped := make([]perfmetrics.TokenResult, 0, len(tokens))
	for _, token := range tokens {
		ownership, known := ownerships[token.TokenId]
		if !isAdmin && (!known || ownership.UserId != userId) {
			continue
		}
		if token.TokenName == "" && known {
			token.TokenName = ownership.Name
		}
		// 归属用户名只下发给管理员:普通用户只看自己的令牌,带上用户名是冗余,
		// 而且会让「自己的令牌」这一视图凭空多出别人的账号信息。
		if isAdmin && known {
			token.OwnerName = ownership.OwnerName
		}
		scoped = append(scoped, token)
	}
	return scoped
}

func filterActiveGroups(groups []perfmetrics.GroupResult) []perfmetrics.GroupResult {
	activeRatios := ratio_setting.GetGroupRatioCopy()
	return lo.Filter(groups, func(g perfmetrics.GroupResult, _ int) bool {
		_, ok := activeRatios[g.Group]
		return ok || g.Group == "auto"
	})
}
