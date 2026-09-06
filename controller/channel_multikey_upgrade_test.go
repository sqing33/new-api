/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

func setupMultiKeyUpgradeTest(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	previousLogDB := model.LOG_DB
	previousType := common.MainDatabaseType()
	previousRedis := common.RedisEnabled
	common.RedisEnabled = false
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.Log{}, &model.User{}))
	model.DB = db
	model.LOG_DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB = previousDB
		model.LOG_DB = previousLogDB
		common.SetMainDatabaseType(previousType)
		common.RedisEnabled = previousRedis
	})
}

func updateChannelViaAPI(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/api/channel/", strings.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("id", 1)
	// 改 key 属敏感写：默认只有 root 持有 ChannelSensitiveWrite。
	ctx.Set("role", common.RoleRootUser)
	UpdateChannel(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)
	return recorder
}

func TestUpdateChannelUpgradesSingleKeyToMultiKey(t *testing.T) {
	setupMultiKeyUpgradeTest(t)
	single := model.Channel{
		Id: 1, Type: 1, Name: "single", Key: "sk-old", Models: "gpt-4o",
		Group: "default", Status: common.ChannelStatusEnabled,
		OtherSettings: "{}",
	}
	require.NoError(t, model.DB.Create(&single).Error)

	recorder := updateChannelViaAPI(t, `{"id":1,"name":"single","type":1,"key":"sk-a\nsk-b\nsk-c","models":"gpt-4o","group":"default","is_multi_key_request":true,"multi_key_mode":"polling","settings":"{}"}`)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())

	updated, err := model.GetChannelById(1, true)
	require.NoError(t, err)
	assert.True(t, updated.ChannelInfo.IsMultiKey, "channel upgraded to multi-key")
	assert.Equal(t, 3, updated.ChannelInfo.MultiKeySize)
	require.NotNil(t, updated.ChannelInfo.MultiKeyStatusList)
	assert.Empty(t, updated.ChannelInfo.MultiKeyStatusList, "fresh per-key state starts empty")
}

func TestUpdateChannelUpgradeRequiresMultipleKeys(t *testing.T) {
	setupMultiKeyUpgradeTest(t)
	single := model.Channel{
		Id: 1, Type: 1, Name: "single", Key: "sk-old", Models: "gpt-4o",
		Group: "default", Status: common.ChannelStatusEnabled,
		OtherSettings: "{}",
	}
	require.NoError(t, model.DB.Create(&single).Error)

	// Upgrade request with a single-line key must NOT flip the channel.
	recorder := updateChannelViaAPI(t, `{"id":1,"name":"single","type":1,"key":"sk-only","models":"gpt-4o","group":"default","is_multi_key_request":true,"settings":"{}"}`)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	updated, err := model.GetChannelById(1, true)
	require.NoError(t, err)
	assert.False(t, updated.ChannelInfo.IsMultiKey, "single-line key stays single-key")
}

func TestUpdateChannelNeverDowngradesMultiKey(t *testing.T) {
	setupMultiKeyUpgradeTest(t)
	multi := model.Channel{
		Id: 1, Type: 1, Name: "multi", Key: "sk-a\nsk-b", Models: "gpt-4o",
		Group: "default", Status: common.ChannelStatusEnabled,
		OtherSettings: "{}",
	}
	multi.ChannelInfo.IsMultiKey = true
	multi.ChannelInfo.MultiKeySize = 2
	require.NoError(t, model.DB.Create(&multi).Error)

	// A client sending is_multi_key_request=false must not downgrade.
	recorder := updateChannelViaAPI(t, `{"id":1,"name":"multi","type":1,"key":"sk-a\nsk-b","models":"gpt-4o","group":"default","is_multi_key_request":false,"settings":"{}"}`)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	updated, err := model.GetChannelById(1, true)
	require.NoError(t, err)
	assert.True(t, updated.ChannelInfo.IsMultiKey, "multi-key is never downgraded")
}
