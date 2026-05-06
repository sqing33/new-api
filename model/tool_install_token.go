package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type ToolInstallToken struct {
	Id           int    `json:"id"`
	UserId       int    `json:"user_id" gorm:"index"`
	TokenHash    string `json:"-" gorm:"type:varchar(128);uniqueIndex"`
	ApiTokenId   int    `json:"api_token_id" gorm:"index"`
	CreatedTime  int64  `json:"created_time" gorm:"bigint"`
	ExpiresAt    int64  `json:"expires_at" gorm:"bigint;index"`
	LastUsedTime int64  `json:"last_used_time" gorm:"bigint;default:0"`
	RevokedTime  int64  `json:"revoked_time" gorm:"bigint;default:0"`
}

type ToolInstallTool struct {
	Id               int                     `json:"id"`
	Slug             string                  `json:"slug" gorm:"type:varchar(64);uniqueIndex"`
	Name             string                  `json:"name" gorm:"type:varchar(128);index"`
	Description      string                  `json:"description" gorm:"type:text"`
	PackageName      string                  `json:"package_name" gorm:"type:varchar(128)"`
	VerifyCommand    string                  `json:"verify_command" gorm:"type:varchar(128)"`
	ShellScript      string                  `json:"shell_script" gorm:"type:text"`
	PowerShellScript string                  `json:"powershell_script" gorm:"type:text"`
	ConfigFilesJSON  string                  `json:"-" gorm:"column:config_files;type:text"`
	ConfigFiles      []ToolInstallConfigFile `json:"config_files" gorm:"-"`
	Enabled          bool                    `json:"enabled" gorm:"default:true;index"`
	CreatedTime      int64                   `json:"created_time" gorm:"bigint"`
	UpdatedTime      int64                   `json:"updated_time" gorm:"bigint"`
	DeletedAt        gorm.DeletedAt          `json:"-" gorm:"index"`
}

type ToolInstallConfigFile struct {
	Platform string `json:"platform"`
	Path     string `json:"path"`
	Content  string `json:"content"`
	Backup   bool   `json:"backup"`
	Enabled  bool   `json:"enabled"`
}

func sanitizeToolInstallConfigFiles(files []ToolInstallConfigFile) []ToolInstallConfigFile {
	items := make([]ToolInstallConfigFile, 0, len(files))
	for _, file := range files {
		platform := strings.ToLower(strings.TrimSpace(file.Platform))
		switch platform {
		case "", "all", "unix", "linux", "macos", "darwin", "windows":
		default:
			platform = "all"
		}
		path := strings.TrimSpace(file.Path)
		if path == "" && strings.TrimSpace(file.Content) == "" {
			continue
		}
		items = append(items, ToolInstallConfigFile{
			Platform: platform,
			Path:     path,
			Content:  file.Content,
			Backup:   file.Backup,
			Enabled:  file.Enabled,
		})
	}
	return items
}

func (tool *ToolInstallTool) normalizeConfigFiles() error {
	tool.ConfigFiles = sanitizeToolInstallConfigFiles(tool.ConfigFiles)
	if len(tool.ConfigFiles) == 0 {
		tool.ConfigFilesJSON = ""
		return nil
	}
	data, err := common.Marshal(tool.ConfigFiles)
	if err != nil {
		return err
	}
	tool.ConfigFilesJSON = string(data)
	return nil
}

func (tool *ToolInstallTool) AfterFind(tx *gorm.DB) error {
	raw := strings.TrimSpace(tool.ConfigFilesJSON)
	if raw == "" {
		tool.ConfigFiles = nil
		return nil
	}
	var files []ToolInstallConfigFile
	if err := common.UnmarshalJsonStr(raw, &files); err != nil {
		return err
	}
	tool.ConfigFiles = sanitizeToolInstallConfigFiles(files)
	return nil
}

func hashToolInstallToken(token string) string {
	return common.GenerateHMAC("tool-install:" + token)
}

func installTokenCacheKey(tokenHash string) string {
	return fmt.Sprintf("tool-install-token:%s", tokenHash)
}

func cacheSetInstallToken(token *ToolInstallToken) {
	if !common.RedisEnabled || token == nil {
		return
	}
	now := common.GetTimestamp()
	ttl := token.ExpiresAt - now
	if ttl <= 0 {
		return
	}
	_ = common.RedisHSetObj(installTokenCacheKey(token.TokenHash), token, time.Duration(ttl)*time.Second)
}

func cacheGetInstallToken(tokenHash string) (*ToolInstallToken, error) {
	if !common.RedisEnabled {
		return nil, fmt.Errorf("redis is not enabled")
	}
	var token ToolInstallToken
	err := common.RedisHGetObj(installTokenCacheKey(tokenHash), &token)
	if err != nil {
		return nil, err
	}
	return &token, nil
}

func cacheDeleteInstallToken(tokenHash string) {
	if !common.RedisEnabled {
		return
	}
	_ = common.RedisDelKey(installTokenCacheKey(tokenHash))
}

func CreateToolInstallToken(userId int, apiTokenId int, expiresAt int64) (*ToolInstallToken, string, error) {
	if userId == 0 || apiTokenId == 0 {
		return nil, "", errors.New("user id or token id is empty")
	}

	plainToken, err := common.GenerateRandomCharsKey(48)
	if err != nil {
		return nil, "", err
	}
	plainToken = "ti_" + plainToken

	installToken := &ToolInstallToken{
		UserId:      userId,
		TokenHash:   hashToolInstallToken(plainToken),
		ApiTokenId:  apiTokenId,
		CreatedTime: common.GetTimestamp(),
		ExpiresAt:   expiresAt,
	}
	if err := DB.Create(installToken).Error; err != nil {
		return nil, "", err
	}

	cacheSetInstallToken(installToken)

	return installToken, plainToken, nil
}

func GetToolInstallTokenByPlain(plainToken string) (*ToolInstallToken, error) {
	plainToken = strings.TrimSpace(plainToken)
	if plainToken == "" {
		return nil, errors.New("install token is empty")
	}

	tokenHash := hashToolInstallToken(plainToken)

	// try Redis first
	if cached, err := cacheGetInstallToken(tokenHash); err == nil && cached != nil {
		now := common.GetTimestamp()
		if cached.RevokedTime > 0 {
			return nil, errors.New("install token has been revoked")
		}
		if cached.ExpiresAt <= now {
			cacheDeleteInstallToken(tokenHash)
			return nil, errors.New("install token has expired")
		}
		return cached, nil
	}

	// fallback to DB
	installToken := &ToolInstallToken{}
	err := DB.Where("token_hash = ?", tokenHash).First(installToken).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("install token is invalid")
		}
		return nil, err
	}

	now := common.GetTimestamp()
	if installToken.RevokedTime > 0 {
		return nil, errors.New("install token has been revoked")
	}
	if installToken.ExpiresAt <= now {
		return nil, errors.New("install token has expired")
	}

	// backfill Redis
	cacheSetInstallToken(installToken)

	return installToken, nil
}

func ResolveToolInstallToken(plainToken string) (*ToolInstallToken, *Token, error) {
	installToken, err := GetToolInstallTokenByPlain(plainToken)
	if err != nil {
		return nil, nil, err
	}

	apiToken, err := GetTokenByIds(installToken.ApiTokenId, installToken.UserId)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to load api token: %w", err)
	}
	if apiToken.Status != common.TokenStatusEnabled {
		return nil, nil, errors.New("api token is not enabled")
	}
	if apiToken.ExpiredTime != -1 && apiToken.ExpiredTime <= common.GetTimestamp() {
		return nil, nil, errors.New("api token has expired")
	}
	if !apiToken.UnlimitedQuota && apiToken.RemainQuota <= 0 {
		return nil, nil, errors.New("api token quota is exhausted")
	}

	if err := DB.Model(installToken).Update("last_used_time", common.GetTimestamp()).Error; err != nil {
		common.SysLog("failed to update tool install token last_used_time: " + err.Error())
	}
	if common.RedisEnabled {
		_ = common.RedisHSetField(installTokenCacheKey(installToken.TokenHash), "LastUsedTime", common.GetTimestamp())
	}

	return installToken, apiToken, nil
}

func GetEnabledToolInstallTools() ([]*ToolInstallTool, error) {
	tools := make([]*ToolInstallTool, 0)
	err := DB.Where("enabled = ?", true).Order("id asc").Find(&tools).Error
	return tools, err
}

func GetAllToolInstallTools() ([]*ToolInstallTool, error) {
	tools := make([]*ToolInstallTool, 0)
	err := DB.Order("id asc").Find(&tools).Error
	return tools, err
}

func GetToolInstallToolBySlug(slug string) (*ToolInstallTool, error) {
	tool := &ToolInstallTool{}
	if err := DB.Where("slug = ?", strings.TrimSpace(slug)).First(tool).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("tool is not found")
		}
		return nil, err
	}
	return tool, nil
}

func GetToolInstallToolById(id int) (*ToolInstallTool, error) {
	if id == 0 {
		return nil, errors.New("tool id is empty")
	}
	tool := &ToolInstallTool{}
	if err := DB.First(tool, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("tool is not found")
		}
		return nil, err
	}
	return tool, nil
}

func SaveToolInstallTool(tool *ToolInstallTool) error {
	now := common.GetTimestamp()
	tool.Slug = strings.TrimSpace(tool.Slug)
	tool.Name = strings.TrimSpace(tool.Name)
	tool.PackageName = strings.TrimSpace(tool.PackageName)
	tool.VerifyCommand = strings.TrimSpace(tool.VerifyCommand)
	if err := tool.normalizeConfigFiles(); err != nil {
		return err
	}
	tool.UpdatedTime = now
	if tool.Id == 0 {
		tool.CreatedTime = now
		return DB.Create(tool).Error
	}
	return DB.Save(tool).Error
}

func DeleteToolInstallTool(id int) error {
	return DB.Unscoped().Delete(&ToolInstallTool{}, id).Error
}

func EnsureDefaultToolInstallTools() error {
	defaults := []*ToolInstallTool{
		{
			Slug:             "claude-code",
			Name:             "Claude Code",
			Description:      "Install Claude Code and configure it for this API gateway.",
			PackageName:      "@anthropic-ai/claude-code",
			VerifyCommand:    "claude --version",
			ShellScript:      defaultClaudeCodeShellScript,
			PowerShellScript: defaultClaudeCodePowerShellScript,
			ConfigFiles: []ToolInstallConfigFile{
				{
					Platform: "unix",
					Path:     "~/.claude/settings.json",
					Content:  defaultClaudeCodeSettingsJSON,
					Backup:   true,
					Enabled:  true,
				},
				{
					Platform: "windows",
					Path:     "$env:USERPROFILE\\.claude\\settings.json",
					Content:  defaultClaudeCodeSettingsJSON,
					Backup:   true,
					Enabled:  true,
				},
			},
			Enabled: true,
		},
		{
			Slug:             "codex",
			Name:             "Codex",
			Description:      "Install Codex CLI and configure OpenAI-compatible access.",
			PackageName:      "@openai/codex",
			VerifyCommand:    "codex --version",
			ShellScript:      defaultCodexShellScript,
			PowerShellScript: defaultCodexPowerShellScript,
			ConfigFiles: []ToolInstallConfigFile{
				{
					Platform: "unix",
					Path:     "~/.codex/config.toml",
					Content:  defaultCodexConfigTOML,
					Backup:   true,
					Enabled:  true,
				},
				{
					Platform: "windows",
					Path:     "$env:USERPROFILE\\.codex\\config.toml",
					Content:  defaultCodexConfigTOML,
					Backup:   true,
					Enabled:  true,
				},
			},
			Enabled: true,
		},
	}
	for _, item := range defaults {
		existing := &ToolInstallTool{}
		err := DB.Where("slug = ?", item.Slug).First(existing).Error
		if err == nil {
			if strings.TrimSpace(existing.ConfigFilesJSON) == "" && len(existing.ConfigFiles) == 0 && len(item.ConfigFiles) > 0 {
				existing.ConfigFiles = item.ConfigFiles
				if err := SaveToolInstallTool(existing); err != nil {
					return err
				}
			}
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := SaveToolInstallTool(item); err != nil {
			return err
		}
	}
	return nil
}

const defaultCodexConfigTOML = `model_provider = "new-api"

[model_providers.new-api]
name = "New API"
base_url = "{{OPENAI_BASE_URL}}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
`

const defaultClaudeCodeSettingsJSON = `{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "{{API_KEY}}",
    "ANTHROPIC_BASE_URL": "{{BASE_URL}}"
  }
}
`

const defaultCodexShellScript = `#!/usr/bin/env sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 18+ and run this script again." >&2
  exit 1
fi

PM=""
if command -v bun >/dev/null 2>&1; then
  PM="bun"
elif command -v pnpm >/dev/null 2>&1; then
  PM="pnpm"
elif command -v npm >/dev/null 2>&1; then
  PM="npm"
else
  echo "A package manager (bun, pnpm, or npm) is required." >&2
  exit 1
fi

"$PM" install -g "@openai/codex"

TMP_CONFIG="$(mktemp)"
cleanup() { rm -f "$TMP_CONFIG"; }
trap cleanup EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "{{CONFIG_URL}}" -o "$TMP_CONFIG"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP_CONFIG" "{{CONFIG_URL}}"
else
  echo "curl or wget is required to fetch configuration." >&2
  exit 1
fi

API_KEY="$(node -e "const fs=require('fs'); const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!r.success) throw new Error(r.message || 'Failed to fetch config'); console.log(r.data.api_key)" "$TMP_CONFIG")"
OPENAI_BASE_URL="$(node -e "const fs=require('fs'); const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!r.success) throw new Error(r.message || 'Failed to fetch config'); console.log(r.data.openai_base_url)" "$TMP_CONFIG")"

PROFILE_FILE="${HOME}/.profile"
if [ -n "${ZSH_VERSION:-}" ]; then
  PROFILE_FILE="${HOME}/.zshrc"
elif [ -n "${BASH_VERSION:-}" ]; then
  PROFILE_FILE="${HOME}/.bashrc"
fi

{
  echo ""
  echo "# >>> New API Codex >>>"
  echo "OPENAI_API_KEY=\"$API_KEY\""
  echo "OPENAI_BASE_URL=\"$OPENAI_BASE_URL\""
  echo "export OPENAI_API_KEY OPENAI_BASE_URL"
  echo "# <<< New API Codex <<<"
} >> "$PROFILE_FILE"

echo "Codex installed and configured."
echo "Restart your terminal or run: . \"$PROFILE_FILE\""
echo "Verify with: codex --version"
`

const defaultClaudeCodeShellScript = `#!/usr/bin/env sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 18+ and run this script again." >&2
  exit 1
fi

PM=""
if command -v bun >/dev/null 2>&1; then
  PM="bun"
elif command -v pnpm >/dev/null 2>&1; then
  PM="pnpm"
elif command -v npm >/dev/null 2>&1; then
  PM="npm"
else
  echo "A package manager (bun, pnpm, or npm) is required." >&2
  exit 1
fi

"$PM" install -g "@anthropic-ai/claude-code"

TMP_CONFIG="$(mktemp)"
cleanup() { rm -f "$TMP_CONFIG"; }
trap cleanup EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "{{CONFIG_URL}}" -o "$TMP_CONFIG"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP_CONFIG" "{{CONFIG_URL}}"
else
  echo "curl or wget is required to fetch configuration." >&2
  exit 1
fi

API_KEY="$(node -e "const fs=require('fs'); const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!r.success) throw new Error(r.message || 'Failed to fetch config'); console.log(r.data.api_key)" "$TMP_CONFIG")"
BASE_URL="$(node -e "const fs=require('fs'); const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!r.success) throw new Error(r.message || 'Failed to fetch config'); console.log(r.data.base_url)" "$TMP_CONFIG")"

PROFILE_FILE="${HOME}/.profile"
if [ -n "${ZSH_VERSION:-}" ]; then
  PROFILE_FILE="${HOME}/.zshrc"
elif [ -n "${BASH_VERSION:-}" ]; then
  PROFILE_FILE="${HOME}/.bashrc"
fi

{
  echo ""
  echo "# >>> New API Claude Code >>>"
  echo "ANTHROPIC_AUTH_TOKEN=\"$API_KEY\""
  echo "ANTHROPIC_BASE_URL=\"$BASE_URL\""
  echo "export ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL"
  echo "# <<< New API Claude Code <<<"
} >> "$PROFILE_FILE"

echo "Claude Code installed and configured."
echo "Restart your terminal or run: . \"$PROFILE_FILE\""
echo "Verify with: claude --version"
`

const defaultCodexPowerShellScript = `$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required. Install Node.js 18+ and run this script again."
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

& $PM install -g "@openai/codex"

$Response = Invoke-RestMethod -Uri "{{CONFIG_URL}}" -Method Get
if (-not $Response.success) {
  throw ($Response.message ?? "Failed to fetch config")
}

[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $Response.data.api_key, "User")
[Environment]::SetEnvironmentVariable("OPENAI_BASE_URL", $Response.data.openai_base_url, "User")
$env:OPENAI_API_KEY = $Response.data.api_key
$env:OPENAI_BASE_URL = $Response.data.openai_base_url

Write-Host "Codex installed and configured."
Write-Host "Restart your terminal, then verify with: codex --version"
`

const defaultClaudeCodePowerShellScript = `$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required. Install Node.js 18+ and run this script again."
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

& $PM install -g "@anthropic-ai/claude-code"

$Response = Invoke-RestMethod -Uri "{{CONFIG_URL}}" -Method Get
if (-not $Response.success) {
  throw ($Response.message ?? "Failed to fetch config")
}

[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $Response.data.api_key, "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", $Response.data.base_url, "User")
$env:ANTHROPIC_AUTH_TOKEN = $Response.data.api_key
$env:ANTHROPIC_BASE_URL = $Response.data.base_url

Write-Host "Claude Code installed and configured."
Write-Host "Restart your terminal, then verify with: claude --version"
`

func CleanupExpiredToolInstallTokens(beforeTimestamp int64) (int64, error) {
	result := DB.Where("expires_at <= ? AND expires_at > 0", beforeTimestamp).Delete(&ToolInstallToken{})
	return result.RowsAffected, result.Error
}
