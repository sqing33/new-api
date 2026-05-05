package controller

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

const defaultToolInstallTTLSeconds int64 = 15 * 60
const maxToolInstallTTLSeconds int64 = 60 * 60

var toolInstallSlugRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$`)

type createToolInstallTokenRequest struct {
	ApiTokenId     int   `json:"api_token_id"`
	ExpiresSeconds int64 `json:"expires_seconds,omitempty"`
}

type saveToolInstallToolRequest struct {
	Slug             string `json:"slug"`
	Name             string `json:"name"`
	Description      string `json:"description"`
	PackageName      string `json:"package_name"`
	VerifyCommand    string `json:"verify_command"`
	ShellScript      string `json:"shell_script"`
	PowerShellScript string `json:"powershell_script"`
	Enabled          bool   `json:"enabled"`
}

func getRequestBaseURL(c *gin.Context) string {
	baseURL := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	if baseURL != "" {
		return baseURL
	}
	scheme := "http"
	if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + c.Request.Host
}

func formatAPIKey(key string) string {
	key = strings.TrimSpace(key)
	if strings.HasPrefix(key, "sk-") {
		return key
	}
	return "sk-" + key
}

func normalizeToolInstallSlug(slug string) (string, error) {
	slug = strings.ToLower(strings.TrimSpace(slug))
	if slug == "" {
		return "", errors.New("tool slug is required")
	}
	if !toolInstallSlugRegex.MatchString(slug) {
		return "", errors.New("tool slug can only contain lowercase letters, numbers, and hyphens")
	}
	return slug, nil
}

func buildToolInstallConfigURL(baseURL string, slug string, token string) string {
	return fmt.Sprintf(
		"%s/api/tool-install/config?tool=%s&token=%s",
		baseURL,
		url.QueryEscape(slug),
		url.QueryEscape(token),
	)
}

func renderToolInstallScript(template string, baseURL string, tool *model.ToolInstallTool, token string) string {
	configURL := buildToolInstallConfigURL(baseURL, tool.Slug, token)
	replacer := strings.NewReplacer(
		"{{TOOL_ID}}", tool.Slug,
		"{{TOOL_SLUG}}", tool.Slug,
		"{{TOOL_NAME}}", tool.Name,
		"{{PACKAGE_NAME}}", tool.PackageName,
		"{{VERIFY_COMMAND}}", tool.VerifyCommand,
		"{{INSTALL_KEY}}", token,
		"{{CONFIG_URL}}", configURL,
		"{{BASE_URL}}", baseURL,
		"{{OPENAI_BASE_URL}}", baseURL+"/v1",
	)
	return replacer.Replace(template)
}

func validateApiTokenForInstall(c *gin.Context, apiTokenId int) (*model.Token, bool) {
	if apiTokenId == 0 {
		common.ApiErrorMsg(c, "api token id is required")
		return nil, false
	}

	userId := c.GetInt("id")
	apiToken, err := model.GetTokenByIds(apiTokenId, userId)
	if err != nil {
		common.ApiError(c, err)
		return nil, false
	}
	if apiToken.Status != common.TokenStatusEnabled {
		common.ApiErrorMsg(c, "api token is not enabled")
		return nil, false
	}
	if apiToken.ExpiredTime != -1 && apiToken.ExpiredTime <= common.GetTimestamp() {
		common.ApiErrorMsg(c, "api token has expired")
		return nil, false
	}
	if !apiToken.UnlimitedQuota && apiToken.RemainQuota <= 0 {
		common.ApiErrorMsg(c, "api token quota is exhausted")
		return nil, false
	}
	return apiToken, true
}

func GetToolInstallTools(c *gin.Context) {
	tools, err := model.GetEnabledToolInstallTools()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(tools))
	for _, tool := range tools {
		items = append(items, gin.H{
			"id":             tool.Id,
			"slug":           tool.Slug,
			"name":           tool.Name,
			"description":    tool.Description,
			"package_name":   tool.PackageName,
			"verify_command": tool.VerifyCommand,
			"enabled":        tool.Enabled,
			"created_time":   tool.CreatedTime,
			"updated_time":   tool.UpdatedTime,
		})
	}
	common.ApiSuccess(c, items)
}

func CreateToolInstallToken(c *gin.Context) {
	var req createToolInstallTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := validateApiTokenForInstall(c, req.ApiTokenId); !ok {
		return
	}

	ttl := req.ExpiresSeconds
	if ttl <= 0 {
		ttl = defaultToolInstallTTLSeconds
	}
	if ttl > maxToolInstallTTLSeconds {
		ttl = maxToolInstallTTLSeconds
	}
	expiresAt := common.GetTimestamp() + ttl

	installToken, plainToken, err := model.CreateToolInstallToken(c.GetInt("id"), req.ApiTokenId, expiresAt)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"token":        plainToken,
		"expires_at":   installToken.ExpiresAt,
		"api_token_id": installToken.ApiTokenId,
	})
}

func GetToolInstallConfig(c *gin.Context) {
	slug, err := normalizeToolInstallSlug(c.Query("tool"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	tool, err := model.GetToolInstallToolBySlug(slug)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !tool.Enabled {
		common.ApiErrorMsg(c, "tool is disabled")
		return
	}

	_, apiToken, err := model.ResolveToolInstallToken(c.Query("token"))
	if err != nil {
		common.ApiError(c, err)
		return
	}

	baseURL := getRequestBaseURL(c)
	common.ApiSuccess(c, gin.H{
		"tool":            slug,
		"tool_name":       tool.Name,
		"api_key":         formatAPIKey(apiToken.GetFullKey()),
		"base_url":        baseURL,
		"openai_base_url": baseURL + "/v1",
	})
}

func GetToolInstallScript(c *gin.Context) {
	slug, err := normalizeToolInstallSlug(c.Param("tool"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	platform := strings.ToLower(strings.TrimSpace(c.Param("platform")))
	if platform != "sh" && platform != "ps1" {
		common.ApiErrorMsg(c, "unsupported script platform")
		return
	}

	tool, err := model.GetToolInstallToolBySlug(slug)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !tool.Enabled {
		common.ApiErrorMsg(c, "tool is disabled")
		return
	}
	if _, _, err := model.ResolveToolInstallToken(c.Query("token")); err != nil {
		common.ApiError(c, err)
		return
	}

	template := tool.ShellScript
	contentType := "text/x-shellscript; charset=utf-8"
	if platform == "ps1" {
		template = tool.PowerShellScript
		contentType = "text/plain; charset=utf-8"
	}
	if strings.TrimSpace(template) == "" {
		common.ApiErrorMsg(c, "script is not configured")
		return
	}

	c.Header("Cache-Control", "no-store")
	c.Header("Content-Type", contentType)
	c.String(http.StatusOK, renderToolInstallScript(template, getRequestBaseURL(c), tool, c.Query("token")))
}

func GetAdminToolInstallTools(c *gin.Context) {
	tools, err := model.GetAllToolInstallTools()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, tools)
}

func CreateAdminToolInstallTool(c *gin.Context) {
	saveAdminToolInstallTool(c, nil)
}

func UpdateAdminToolInstallTool(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	tool, err := model.GetToolInstallToolById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	saveAdminToolInstallTool(c, tool)
}

func DeleteAdminToolInstallTool(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DeleteToolInstallTool(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, true)
}

func saveAdminToolInstallTool(c *gin.Context, tool *model.ToolInstallTool) {
	var req saveToolInstallToolRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	slug, err := normalizeToolInstallSlug(req.Slug)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		common.ApiErrorMsg(c, "tool name is required")
		return
	}
	if tool == nil {
		tool = &model.ToolInstallTool{}
	}
	tool.Slug = slug
	tool.Name = req.Name
	tool.Description = req.Description
	tool.PackageName = req.PackageName
	tool.VerifyCommand = req.VerifyCommand
	tool.ShellScript = req.ShellScript
	tool.PowerShellScript = req.PowerShellScript
	tool.Enabled = req.Enabled

	if err := model.SaveToolInstallTool(tool); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, tool)
}
