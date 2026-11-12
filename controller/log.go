package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

// isGenerativeModelSetting 判断该模型是否属于「生成类」工作台能力
// （生图 / 视频 / TTS / ASR）。清荫日志收录这些模型，通用日志则把它们
// 排除，避免污染文本模型的用量视图。
func isGenerativeModelSetting(item setting.ImageModelSetting) bool {
	return len(item.Modes) > 0 ||
		len(item.VideoModes) > 0 ||
		len(item.TTSModes) > 0 ||
		len(item.ASRModes) > 0
}

// getConfiguredImageLogModels 返回所有生成类模型名。函数名沿用历史命名，
// 但涵盖范围已从生图扩展到视频、TTS 与 ASR。
func getConfiguredImageLogModels() []string {
	modelSet := map[string]bool{}
	models := make([]string, 0)
	for _, item := range setting.ImageModelSettings {
		if strings.TrimSpace(item.Model) == "" || !isGenerativeModelSetting(item) {
			continue
		}
		if modelSet[item.Model] {
			continue
		}
		modelSet[item.Model] = true
		models = append(models, item.Model)
	}
	return models
}

func getLogModelFilters(c *gin.Context) (string, []string) {
	modelName := c.Query("model_name")
	modelNames := c.QueryArray("model_names")
	if len(modelNames) == 0 {
		rawModelNames := strings.TrimSpace(c.Query("model_names"))
		if rawModelNames != "" {
			modelNames = strings.Split(rawModelNames, ",")
		}
	}
	normalizedModelNames := make([]string, 0, len(modelNames))
	modelSet := map[string]bool{}
	for _, item := range modelNames {
		model := strings.TrimSpace(item)
		if model == "" || modelSet[model] {
			continue
		}
		modelSet[model] = true
		normalizedModelNames = append(normalizedModelNames, model)
	}
	// image_only 表示「只看生成类模型」，它是页面语义而非用户筛选条件，
	// 因此无论前端是否勾选具体模型都必须生效：
	//   - 未勾选：限定为全部生成类模型（前端输入框留空即走这一支）
	//   - 已勾选：与生成类名单取交集，避免前端传入非生成类模型绕过页面语义
	if c.Query("image_only") == "true" {
		generative := getConfiguredImageLogModels()
		if modelName == "" && len(normalizedModelNames) == 0 {
			normalizedModelNames = generative
		} else if len(generative) > 0 {
			allowed := make(map[string]bool, len(generative))
			for _, model := range generative {
				allowed[model] = true
			}
			intersection := make([]string, 0, len(normalizedModelNames))
			for _, model := range normalizedModelNames {
				if allowed[model] {
					intersection = append(intersection, model)
				}
			}
			// 交集为空说明勾选的都不是生成类模型，回退到全量而不是返回空列表
			if len(intersection) == 0 {
				intersection = generative
			}
			normalizedModelNames = intersection
		}
	}
	return modelName, normalizedModelNames
}

// getLogModelExclusions 解析需要排除的模型列表。
// exclude_image_models=true 时复用与 /image-logs 相同的生图模型名单，
// 保证「清荫日志里有的」与「通用日志里排除的」始终是同一批模型。
func getLogModelExclusions(c *gin.Context) []string {
	if c.Query("exclude_image_models") != "true" {
		return nil
	}
	return getConfiguredImageLogModels()
}

func GetAllLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	username := c.Query("username")
	tokenName := c.Query("token_name")
	modelName, modelNames := getLogModelFilters(c)
	excludeModelNames := getLogModelExclusions(c)
	channel, _ := strconv.Atoi(c.Query("channel"))
	group := c.Query("group")
	requestId := c.Query("request_id")
	upstreamRequestId := c.Query("upstream_request_id")
	logs, total, err := model.GetAllLogs(logType, startTimestamp, endTimestamp, modelName, modelNames, excludeModelNames, username, tokenName, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), channel, group, requestId, upstreamRequestId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if c.GetInt("role") < common.RoleRootUser {
		model.FormatAdminLogs(logs)
	} else {
		model.FormatRootLogs(logs)
	}
	model.AttachLogUserAvatars(logs)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
	return
}

func GetUserLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	userId := c.GetInt("id")
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	tokenName := c.Query("token_name")
	modelName, modelNames := getLogModelFilters(c)
	excludeModelNames := getLogModelExclusions(c)
	group := c.Query("group")
	requestId := c.Query("request_id")
	upstreamRequestId := c.Query("upstream_request_id")
	logs, total, err := model.GetUserLogs(userId, logType, startTimestamp, endTimestamp, modelName, modelNames, excludeModelNames, tokenName, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), group, requestId, upstreamRequestId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
	return
}

// Deprecated: SearchAllLogs 已废弃，前端未使用该接口。
func SearchAllLogs(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": false,
		"message": "该接口已废弃",
	})
}

// Deprecated: SearchUserLogs 已废弃，前端未使用该接口。
func SearchUserLogs(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": false,
		"message": "该接口已废弃",
	})
}

func GetLogByKey(c *gin.Context) {
	tokenId := c.GetInt("token_id")
	if tokenId == 0 {
		c.JSON(200, gin.H{
			"success": false,
			"message": "无效的令牌",
		})
		return
	}
	logs, err := model.GetLogByTokenId(tokenId)
	if err != nil {
		c.JSON(200, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"message": "",
		"data":    logs,
	})
}

func GetLogsStat(c *gin.Context) {
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	tokenName := c.Query("token_name")
	username := c.Query("username")
	modelName, modelNames := getLogModelFilters(c)
	excludeModelNames := getLogModelExclusions(c)
	channel, _ := strconv.Atoi(c.Query("channel"))
	group := c.Query("group")
	stat, err := model.SumUsedQuota(logType, startTimestamp, endTimestamp, modelName, modelNames, excludeModelNames, username, tokenName, channel, group)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	//tokenNum := model.SumUsedToken(logType, startTimestamp, endTimestamp, modelName, username, "")
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"quota":             stat.Quota,
			"prompt_tokens":     stat.PromptTokens,
			"completion_tokens": stat.CompletionTokens,
			"rpm":               stat.Rpm,
			"tpm":               stat.Tpm,
		},
	})
	return
}

func GetLogsSelfStat(c *gin.Context) {
	username := c.GetString("username")
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	tokenName := c.Query("token_name")
	modelName, modelNames := getLogModelFilters(c)
	excludeModelNames := getLogModelExclusions(c)
	channel, _ := strconv.Atoi(c.Query("channel"))
	group := c.Query("group")
	quotaNum, err := model.SumUsedQuota(logType, startTimestamp, endTimestamp, modelName, modelNames, excludeModelNames, username, tokenName, channel, group)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	//tokenNum := model.SumUsedToken(logType, startTimestamp, endTimestamp, modelName, username, tokenName)
	c.JSON(200, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"quota":             quotaNum.Quota,
			"prompt_tokens":     quotaNum.PromptTokens,
			"completion_tokens": quotaNum.CompletionTokens,
			"rpm":               quotaNum.Rpm,
			"tpm":               quotaNum.Tpm,
			//"token": tokenNum,
		},
	})
	return
}

func DeleteHistoryLogs(c *gin.Context) {
	targetTimestamp, _ := strconv.ParseInt(c.Query("target_timestamp"), 10, 64)
	if targetTimestamp == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "target timestamp is required",
		})
		return
	}
	var count int64
	for {
		n, err := model.DeleteOldLogBatch(c.Request.Context(), targetTimestamp, 1000)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		count += n
		if n < 1000 {
			break
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    count,
	})
	return
}
