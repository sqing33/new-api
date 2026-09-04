package controller

import (
	"encoding/base64"
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
	Slug             string                        `json:"slug"`
	Name             string                        `json:"name"`
	Description      string                        `json:"description"`
	PackageName      string                        `json:"package_name"`
	VerifyCommand    string                        `json:"verify_command"`
	ShellScript      string                        `json:"shell_script"`
	PowerShellScript string                        `json:"powershell_script"`
	ConfigFiles      []model.ToolInstallConfigFile `json:"config_files"`
	Enabled          bool                          `json:"enabled"`
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

func isConfigFileForPlatform(file model.ToolInstallConfigFile, platform string) bool {
	if !file.Enabled || strings.TrimSpace(file.Path) == "" {
		return false
	}
	filePlatform := strings.ToLower(strings.TrimSpace(file.Platform))
	if filePlatform == "" || filePlatform == "all" {
		return true
	}
	if platform == "ps1" {
		return filePlatform == "windows"
	}
	return filePlatform == "unix" || filePlatform == "linux" || filePlatform == "macos" || filePlatform == "darwin"
}

func getToolInstallConfigFilesForPlatform(tool *model.ToolInstallTool, platform string) []model.ToolInstallConfigFile {
	items := make([]model.ToolInstallConfigFile, 0, len(tool.ConfigFiles))
	for _, file := range tool.ConfigFiles {
		if isConfigFileForPlatform(file, platform) {
			items = append(items, file)
		}
	}
	return items
}

func encodeToolInstallConfigFiles(files []model.ToolInstallConfigFile) (string, error) {
	data, err := common.Marshal(files)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

func shellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func powerShellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func renderGeneratedToolInstallShellScript(baseURL string, tool *model.ToolInstallTool, token string, files []model.ToolInstallConfigFile) (string, error) {
	filesBase64, err := encodeToolInstallConfigFiles(files)
	if err != nil {
		return "", err
	}
	configURL := buildToolInstallConfigURL(baseURL, tool.Slug, token)
	template := `#!/usr/bin/env sh
set -eu

log() { printf '[%s] %s\n' __TOOL_NAME__ "$1"; }
fail() { printf '[%s] ERROR: %s\n' __TOOL_NAME__ "$1" >&2; exit 1; }

PACKAGE_NAME=__PACKAGE_NAME__
VERIFY_COMMAND=__VERIFY_COMMAND__
CONFIG_URL=__CONFIG_URL__
INSTALL_KEY=__INSTALL_KEY__
BASE_URL=__BASE_URL__
OPENAI_BASE_URL=__OPENAI_BASE_URL__
CONFIG_FILES_B64=__CONFIG_FILES_B64__

command -v node >/dev/null 2>&1 || fail "Node.js is required. Install Node.js 18+ and run this installer again."

if command -v bun >/dev/null 2>&1; then
  PM="bun"
elif command -v pnpm >/dev/null 2>&1; then
  PM="pnpm"
elif command -v npm >/dev/null 2>&1; then
  PM="npm"
else
  fail "A package manager (bun, pnpm, or npm) is required."
fi

if [ -n "$PACKAGE_NAME" ]; then
  log "Installing package via $PM: $PACKAGE_NAME"
  "$PM" install -g "$PACKAGE_NAME" || fail "$PM global installation failed"
fi

TMP_CONFIG="$(mktemp)"
cleanup() { rm -f "$TMP_CONFIG"; }
trap cleanup EXIT

log "Fetching New API configuration"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$CONFIG_URL" -o "$TMP_CONFIG" || fail "Failed to fetch configuration with curl"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP_CONFIG" "$CONFIG_URL" || fail "Failed to fetch configuration with wget"
else
  fail "curl or wget is required to fetch configuration"
fi

node - "$TMP_CONFIG" "$CONFIG_FILES_B64" "$INSTALL_KEY" "$CONFIG_URL" "$BASE_URL" "$OPENAI_BASE_URL" __TOOL_NAME__ "$PACKAGE_NAME" "$VERIFY_COMMAND" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');

const [configFile, filesBase64, installKey, configUrl, baseUrl, openaiBaseUrl, toolName, packageName, verifyCommand] = process.argv.slice(2);
const response = JSON.parse(fs.readFileSync(configFile, 'utf8'));
if (!response.success) {
  throw new Error(response.message || 'Failed to fetch config');
}
const data = response.data || {};
if (!data.api_key) {
  throw new Error('New API config response is missing data.api_key');
}

const replacements = {
  '{{API_KEY}}': String(data.api_key || ''),
  '{{OPENAI_BASE_URL}}': String(data.openai_base_url || openaiBaseUrl || ''),
  '{{BASE_URL}}': String(data.base_url || baseUrl || ''),
  '{{CONFIG_URL}}': configUrl,
  '{{INSTALL_KEY}}': installKey,
  '{{TOOL_NAME}}': toolName,
  '{{PACKAGE_NAME}}': packageName,
  '{{VERIFY_COMMAND}}': verifyCommand,
};

function render(value) {
  let output = String(value || '');
  for (const [key, replacement] of Object.entries(replacements)) {
    output = output.split(key).join(replacement);
  }
  return output;
}

function expandUnixPath(value) {
  let output = render(value).trim();
  output = output.replace(/^~(?=$|\/)/, os.homedir());
  output = output.replace(/\$\{HOME\}/g, os.homedir()).replace(/\$HOME/g, os.homedir());
  return output;
}

const files = JSON.parse(Buffer.from(filesBase64, 'base64').toString('utf8'));
for (const file of files) {
  if (!file || file.enabled === false) continue;
  const target = expandUnixPath(file.path);
  if (!target) continue;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (file.backup && fs.existsSync(target)) {
    fs.copyFileSync(target, target + '.bak.' + Date.now());
  }
  fs.writeFileSync(target, render(file.content), { encoding: 'utf8', mode: 0o600 });
  console.log('[' + toolName + '] Wrote ' + target);
}
NODE

if [ -n "$VERIFY_COMMAND" ]; then
  log "Verifying installation: $VERIFY_COMMAND"
  sh -c "$VERIFY_COMMAND" || fail "Verification command failed"
fi

log "Installation completed successfully"
`
	replacer := strings.NewReplacer(
		"__TOOL_NAME__", shellSingleQuote(tool.Name),
		"__PACKAGE_NAME__", shellSingleQuote(tool.PackageName),
		"__VERIFY_COMMAND__", shellSingleQuote(tool.VerifyCommand),
		"__CONFIG_URL__", shellSingleQuote(configURL),
		"__INSTALL_KEY__", shellSingleQuote(token),
		"__BASE_URL__", shellSingleQuote(baseURL),
		"__OPENAI_BASE_URL__", shellSingleQuote(baseURL+"/v1"),
		"__CONFIG_FILES_B64__", shellSingleQuote(filesBase64),
	)
	return replacer.Replace(template), nil
}

func renderGeneratedToolInstallPowerShellScript(baseURL string, tool *model.ToolInstallTool, token string, files []model.ToolInstallConfigFile) (string, error) {
	filesBase64, err := encodeToolInstallConfigFiles(files)
	if err != nil {
		return "", err
	}
	configURL := buildToolInstallConfigURL(baseURL, tool.Slug, token)
	template := `$ErrorActionPreference = "Stop"

function Write-ToolLog {
  param([string]$Message)
  Write-Host "[$(__TOOL_NAME__)] $Message"
}

$PackageName = __PACKAGE_NAME__
$VerifyCommand = __VERIFY_COMMAND__
$ConfigUrl = __CONFIG_URL__
$InstallKey = __INSTALL_KEY__
$BaseUrl = __BASE_URL__
$OpenAIBaseUrl = __OPENAI_BASE_URL__
$ConfigFilesBase64 = __CONFIG_FILES_B64__

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required. Install Node.js 18+ and run this installer again."
}

$PM = $null
if (Get-Command bun -ErrorAction SilentlyContinue) {
  $PM = "bun"
} elseif (Get-Command pnpm -ErrorAction SilentlyContinue) {
  $PM = "pnpm"
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
  $PM = "npm"
} else {
  throw "A package manager (bun, pnpm, or npm) is required."
}

if ($PackageName) {
  Write-ToolLog "Installing package via ${PM}: $PackageName"
  & $PM install -g $PackageName
}

Write-ToolLog "Fetching New API configuration"
$Response = Invoke-RestMethod -Uri $ConfigUrl -Method Get
if (-not $Response.success) {
  if ($Response.message) {
    throw $Response.message
  }
  throw "Failed to fetch config"
}
if (-not $Response.data.api_key) {
  throw "New API config response is missing data.api_key"
}

$ConfigFilesJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($ConfigFilesBase64))
$ConfigFiles = $ConfigFilesJson | ConvertFrom-Json

function Render-Template {
  param([string]$Value)
  if ($null -eq $Value) { return "" }
  $Output = [string]$Value
  $Output = $Output.Replace("{{API_KEY}}", [string]$Response.data.api_key)
  $ResolvedOpenAIBaseUrl = if ($Response.data.openai_base_url) { $Response.data.openai_base_url } else { $OpenAIBaseUrl }
  $ResolvedBaseUrl = if ($Response.data.base_url) { $Response.data.base_url } else { $BaseUrl }
  $Output = $Output.Replace("{{OPENAI_BASE_URL}}", [string]$ResolvedOpenAIBaseUrl)
  $Output = $Output.Replace("{{BASE_URL}}", [string]$ResolvedBaseUrl)
  $Output = $Output.Replace("{{CONFIG_URL}}", $ConfigUrl)
  $Output = $Output.Replace("{{INSTALL_KEY}}", $InstallKey)
  $Output = $Output.Replace("{{TOOL_NAME}}", __TOOL_NAME__)
  $Output = $Output.Replace("{{PACKAGE_NAME}}", $PackageName)
  $Output = $Output.Replace("{{VERIFY_COMMAND}}", $VerifyCommand)
  return $Output
}

function Expand-ConfigPath {
  param([string]$Value)
  $Output = (Render-Template $Value).Trim()
  $Output = $Output.Replace("~", $env:USERPROFILE)
  $Output = $Output.Replace('$env:USERPROFILE', $env:USERPROFILE)
  $Output = $Output.Replace('${env:USERPROFILE}', $env:USERPROFILE)
  $Output = $Output.Replace('%USERPROFILE%', $env:USERPROFILE)
  return $Output
}

foreach ($File in @($ConfigFiles)) {
  if ($File.enabled -eq $false) { continue }
  $Target = Expand-ConfigPath $File.path
  if (-not $Target) { continue }
  $Directory = Split-Path -Parent $Target
  if ($Directory) {
    New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  }
  if ($File.backup -and (Test-Path $Target)) {
    Copy-Item $Target "$Target.bak.$([DateTimeOffset]::Now.ToUnixTimeSeconds())" -Force
  }
  Set-Content -Path $Target -Value (Render-Template $File.content) -Encoding UTF8
  Write-ToolLog "Wrote $Target"
}

if ($VerifyCommand) {
  Write-ToolLog "Verifying installation: $VerifyCommand"
  Invoke-Expression $VerifyCommand
}

Write-ToolLog "Installation completed successfully"
`
	replacer := strings.NewReplacer(
		"__TOOL_NAME__", powerShellSingleQuote(tool.Name),
		"__PACKAGE_NAME__", powerShellSingleQuote(tool.PackageName),
		"__VERIFY_COMMAND__", powerShellSingleQuote(tool.VerifyCommand),
		"__CONFIG_URL__", powerShellSingleQuote(configURL),
		"__INSTALL_KEY__", powerShellSingleQuote(token),
		"__BASE_URL__", powerShellSingleQuote(baseURL),
		"__OPENAI_BASE_URL__", powerShellSingleQuote(baseURL+"/v1"),
		"__CONFIG_FILES_B64__", powerShellSingleQuote(filesBase64),
	)
	return replacer.Replace(template), nil
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

	baseURL := getRequestBaseURL(c)
	configFiles := getToolInstallConfigFilesForPlatform(tool, platform)
	if len(configFiles) > 0 {
		var script string
		var err error
		if platform == "ps1" {
			script, err = renderGeneratedToolInstallPowerShellScript(baseURL, tool, c.Query("token"), configFiles)
		} else {
			script, err = renderGeneratedToolInstallShellScript(baseURL, tool, c.Query("token"), configFiles)
		}
		if err != nil {
			common.ApiError(c, err)
			return
		}
		contentType := "text/x-shellscript; charset=utf-8"
		if platform == "ps1" {
			contentType = "text/plain; charset=utf-8"
		}
		c.Header("Cache-Control", "no-store")
		c.Header("Content-Type", contentType)
		c.String(http.StatusOK, script)
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
	c.String(http.StatusOK, renderToolInstallScript(template, baseURL, tool, c.Query("token")))
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
	if err := validateToolInstallSafety(req.VerifyCommand, req.ConfigFiles); err != nil {
		common.ApiErrorMsg(c, err.Error())
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
	tool.ConfigFiles = req.ConfigFiles
	tool.Enabled = req.Enabled

	if err := model.SaveToolInstallTool(tool); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, tool)
}

// validateToolInstallSafety 限制 admin 保存的 tool install 配置不能做 RCE-as-a-service。
//   - VerifyCommand: 拒绝明显危险模式(curl/wget | sh、> /etc/、rm -rf /
//     等),但允许常见的安全命令(`tool --version`、`--help`)。
//   - ConfigFiles.path: 必须在用户家目录下(以 ~/ 或 ${HOME} 开头),
//     且不能含 `..` 路径穿越。
//
// 这是 best-effort 防护,真正的根本修复是给管理员在 UI 上显著风险提示,
// 并把此功能限定在受信管理员范围。
func validateToolInstallSafety(verifyCommand string, files []model.ToolInstallConfigFile) error {
	vc := strings.TrimSpace(verifyCommand)
	if vc != "" {
		// 拒绝远程代码执行模式
		lower := strings.ToLower(vc)
		for _, danger := range []string{
			"| sh",
			"| bash",
			"| zsh",
			"$(curl",
			"$(wget",
			"> /etc/",
			"> /var/",
			"> /usr/",
			"> /bin/",
			"> /sbin/",
			"rm -rf /",
		} {
			if strings.Contains(lower, danger) {
				return fmt.Errorf("verify_command 包含危险的模式 %q。请改用受信任的本地可执行文件加白名单参数", danger)
			}
		}
	}
	for i, file := range files {
		path := strings.TrimSpace(file.Path)
		if path == "" {
			continue
		}
		// 必须以 ~/ 或 ${HOME} 或 $HOME 开头
		if !(strings.HasPrefix(path, "~/") ||
			strings.HasPrefix(path, "$HOME/") ||
			strings.HasPrefix(path, "${HOME}/") ||
			strings.HasPrefix(path, "$HOME=") ||
			strings.HasPrefix(path, "${HOME}=")) {
			return fmt.Errorf("config_files[%d].path 必须以 ~/ 或 $HOME/ 开头(用户家目录下),不能写系统路径", i)
		}
		// 拒绝 `..` 路径穿越
		if strings.Contains(path, "..") {
			return fmt.Errorf("config_files[%d].path 含 '..' 路径穿越,拒绝", i)
		}
		// 拒绝绝对系统路径(已由前缀判断,再 belt-and-suspenders)
		if strings.HasPrefix(path, "/etc/") || strings.HasPrefix(path, "/var/") ||
			strings.HasPrefix(path, "/usr/") || strings.HasPrefix(path, "/bin/") ||
			strings.HasPrefix(path, "/sbin/") || strings.HasPrefix(path, "/proc/") ||
			strings.HasPrefix(path, "/sys/") || strings.HasPrefix(path, "/dev/") {
			return fmt.Errorf("config_files[%d].path 指向系统目录,拒绝", i)
		}
	}
	return nil
}
