package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// useGroupRatioOptionDB 打开一个只含 options 表的数据库，并接管全局 DB 与选项缓存。
func useGroupRatioOptionDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB := DB
	previousOptionMap := common.OptionMap
	previousIsMasterNode := common.IsMasterNode
	previousGroupRatio := ratio_setting.GroupRatio2JSONString()
	previousGroupUnlimited := ratio_setting.GroupUnlimited2JSONString()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Option{}))
	DB = db
	common.OptionMap = map[string]string{}
	// 回写数据库只发生在主节点上。
	common.IsMasterNode = true
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMap = previousOptionMap
		common.IsMasterNode = previousIsMasterNode
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousGroupRatio))
		require.NoError(t, ratio_setting.UpdateGroupUnlimitedByJSONString(previousGroupUnlimited))
	})
	return db
}

// TestLoadOptionsRestoresUnlimitedGroupsIntoGroupRatio 覆盖存量安装的升级路径：
// 数据库里的 GroupRatio 选项整体覆盖了代码默认值，默认的无限额度分组（Free）因此
// 从倍率表中消失，导致它无法分配给任何用户。加载选项后必须把它补回来并落库。
func TestLoadOptionsRestoresUnlimitedGroupsIntoGroupRatio(t *testing.T) {
	db := useGroupRatioOptionDB(t)
	require.NoError(t, ratio_setting.UpdateGroupUnlimitedByJSONString(`{"Free":true}`))
	require.NoError(t, db.Create(&Option{Key: "GroupRatio", Value: `{"Admin":1,"User":1,"vip":1}`}).Error)

	loadOptionsFromDatabase()

	assert.True(t, ratio_setting.ContainsGroupRatio("Free"))
	assert.True(t, ratio_setting.IsGroupUnlimited("Free"))
	assert.Contains(t, common.OptionMap["GroupRatio"], `"Free":1`)

	var stored Option
	require.NoError(t, db.Where(&Option{Key: "GroupRatio"}).First(&stored).Error)
	assert.Contains(t, stored.Value, `"Free":1`)

	// 补齐后再次加载不应重复改写，数据库保持幂等。
	before := stored.Value
	loadOptionsFromDatabase()
	require.NoError(t, db.Where(&Option{Key: "GroupRatio"}).First(&stored).Error)
	assert.Equal(t, before, stored.Value)
	assert.True(t, ratio_setting.ContainsGroupRatio("Free"))
}

// TestLoadOptionsKeepsRemovedUnlimitedGroups 覆盖管理员显式取消无限额度标记的情况：
// 分组倍率表里没有的分组不应被凭空补回，数据库也不应被改写。
func TestLoadOptionsKeepsRemovedUnlimitedGroups(t *testing.T) {
	db := useGroupRatioOptionDB(t)
	require.NoError(t, ratio_setting.UpdateGroupUnlimitedByJSONString(`{}`))
	require.NoError(t, db.Create(&Option{Key: "GroupRatio", Value: `{"Admin":1,"User":1}`}).Error)
	require.NoError(t, db.Create(&Option{Key: "group_ratio_setting.group_unlimited", Value: `{}`}).Error)

	loadOptionsFromDatabase()

	assert.False(t, ratio_setting.ContainsGroupRatio("Free"))
	assert.False(t, ratio_setting.IsGroupUnlimited("Free"))

	var stored Option
	require.NoError(t, db.Where(&Option{Key: "GroupRatio"}).First(&stored).Error)
	assert.Equal(t, `{"Admin":1,"User":1}`, stored.Value)
}
