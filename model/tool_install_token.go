package model

import (
	"errors"
	"fmt"
	"strings"

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
	Id               int            `json:"id"`
	Slug             string         `json:"slug" gorm:"type:varchar(64);uniqueIndex"`
	Name             string         `json:"name" gorm:"type:varchar(128);index"`
	Description      string         `json:"description" gorm:"type:text"`
	PackageName      string         `json:"package_name" gorm:"type:varchar(128)"`
	VerifyCommand    string         `json:"verify_command" gorm:"type:varchar(128)"`
	ShellScript      string         `json:"shell_script" gorm:"type:text"`
	PowerShellScript string         `json:"powershell_script" gorm:"type:text"`
	Enabled          bool           `json:"enabled" gorm:"default:true;index"`
	CreatedTime      int64          `json:"created_time" gorm:"bigint"`
	UpdatedTime      int64          `json:"updated_time" gorm:"bigint"`
	DeletedAt        gorm.DeletedAt `json:"-" gorm:"index"`
}

func hashToolInstallToken(token string) string {
	return common.GenerateHMAC("tool-install:" + token)
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

	return installToken, plainToken, nil
}

func GetToolInstallTokenByPlain(plainToken string) (*ToolInstallToken, error) {
	plainToken = strings.TrimSpace(plainToken)
	if plainToken == "" {
		return nil, errors.New("install token is empty")
	}

	installToken := &ToolInstallToken{}
	err := DB.Where("token_hash = ?", hashToolInstallToken(plainToken)).First(installToken).Error
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
			Enabled:          true,
		},
		{
			Slug:             "codex",
			Name:             "Codex",
			Description:      "Install Codex CLI and configure OpenAI-compatible access.",
			PackageName:      "@openai/codex",
			VerifyCommand:    "codex --version",
			ShellScript:      defaultCodexShellScript,
			PowerShellScript: defaultCodexPowerShellScript,
			Enabled:          true,
		},
	}
	for _, item := range defaults {
		var count int64
		if err := DB.Model(&ToolInstallTool{}).Where("slug = ?", item.Slug).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		if err := SaveToolInstallTool(item); err != nil {
			return err
		}
	}
	return nil
}

const defaultCodexShellScript = `#!/usr/bin/env sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 18+ and run this script again." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install npm and run this script again." >&2
  exit 1
fi

npm install -g "@openai/codex"

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

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install npm and run this script again." >&2
  exit 1
fi

npm install -g "@anthropic-ai/claude-code"

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

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required. Install npm and run this script again."
}

npm install -g "@openai/codex"

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

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required. Install npm and run this script again."
}

npm install -g "@anthropic-ai/claude-code"

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
