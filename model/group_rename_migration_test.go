package model

import (
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// groupRenameTestDB 保存改名迁移测试用的数据库与分组名引号。
type groupRenameTestDB struct {
	db       *gorm.DB
	groupCol string
	keyCol   string
}

// openGroupRenameTestDB 打开一个用于改名迁移测试的数据库。
// 外部数据库只创建测试需要的表，并在结束后清理测试写入的数据。
func openGroupRenameTestDB(t *testing.T, dialector gorm.Dialector, groupCol string, keyCol string) *groupRenameTestDB {
	t.Helper()
	db, err := gorm.Open(dialector, &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&User{}, &Token{}, &Ability{}, &Channel{}, &Option{}))

	t.Cleanup(func() {
		db.Exec("DELETE FROM options")
		db.Exec("DELETE FROM abilities WHERE model = ?", "gpt-rename")
		db.Exec("DELETE FROM channels WHERE id IN (9001, 9002)")
		db.Exec("DELETE FROM tokens WHERE name = ?", "rename-test")
		db.Exec("DELETE FROM users WHERE username LIKE ?", "rename-user-%")
	})

	// 分组名与选项键在不同方言下的引号不同，迁移直接依赖它们。
	originalGroupCol, originalKeyCol := commonGroupCol, commonKeyCol
	commonGroupCol, commonKeyCol = groupCol, keyCol
	t.Cleanup(func() {
		commonGroupCol, commonKeyCol = originalGroupCol, originalKeyCol
	})

	return &groupRenameTestDB{db: db, groupCol: groupCol, keyCol: keyCol}
}

// seedGroupRenameFixtures 造一批带旧分组名的存量数据。
func seedGroupRenameFixtures(t *testing.T, db *gorm.DB) {
	t.Helper()

	user := User{
		Username:    "rename-user-" + common.GetRandomString(6),
		Password:    "unused-password-hash",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
		AffCode:     "rename-aff-" + common.GetRandomString(8),
	}
	require.NoError(t, db.Create(&user).Error)

	token := Token{
		UserId:      user.Id,
		Key:         "rename-token-" + common.GetRandomString(8),
		Name:        "rename-test",
		Status:      common.TokenStatusEnabled,
		ExpiredTime: -1,
		Group:       "default",
	}
	require.NoError(t, db.Create(&token).Error)

	ability := Ability{Group: "default", Model: "gpt-rename", ChannelId: 1, Enabled: true}
	require.NoError(t, db.Create(&ability).Error)

	channel := Channel{
		Id:     9001,
		Type:   1,
		Key:    "rename-key",
		Status: common.ChannelStatusEnabled,
		Name:   "rename channel",
		Models: "gpt-rename",
		Group:  "default,Admin",
	}
	require.NoError(t, db.Create(&channel).Error)

	// 分组名里含有 default 子串的渠道不能被误伤。
	other := Channel{
		Id:     9002,
		Type:   1,
		Key:    "rename-key-2",
		Status: common.ChannelStatusEnabled,
		Name:   "rename channel 2",
		Models: "gpt-rename",
		Group:  "notdefault",
	}
	require.NoError(t, db.Create(&other).Error)

	options := []Option{
		{Key: "GroupRatio", Value: `{"default":1,"vip":0.8}`},
		{Key: "UserUsableGroups", Value: `{"default":"默认分组","vip":"vip分组"}`},
		{Key: "GroupGroupRatio", Value: `{"default":{"vip":0.5}}`},
		{Key: "group_ratio_setting.group_protected", Value: `{"default":true,"Admin":true}`},
		{Key: "group_ratio_setting.group_user_ratio", Value: `{"default":0.9}`},
		{Key: "group_ratio_setting.group_special_usable_group", Value: `{"default":{"vip":"描述"}}`},
		{Key: "AutoGroups", Value: `["default","vip"]`},
		{Key: "EmptyOption", Value: ""},
	}
	for _, option := range options {
		require.NoError(t, db.Create(&option).Error)
	}
}

func testMigrateUserGroupRename(t *testing.T, target *groupRenameTestDB) {
	t.Helper()
	db := target.db
	seedGroupRenameFixtures(t, db)

	require.NoError(t, migrateUserGroupRename(db))

	var user User
	require.NoError(t, db.First(&user, "username LIKE 'rename-user-%'").Error)
	assert.Equal(t, "User", user.Group)

	var token Token
	require.NoError(t, db.First(&token, "name = ?", "rename-test").Error)
	assert.Equal(t, "User", token.Group)

	var ability Ability
	require.NoError(t, db.First(&ability, "model = ?", "gpt-rename").Error)
	assert.Equal(t, "User", ability.Group)

	// 渠道的分组是逗号分隔的多值，必须按段替换。
	var channel Channel
	require.NoError(t, db.First(&channel, 9001).Error)
	assert.Equal(t, "User,Admin", channel.Group)

	var other Channel
	require.NoError(t, db.First(&other, 9002).Error)
	assert.Equal(t, "notdefault", other.Group)

	values := map[string]string{}
	var options []Option
	require.NoError(t, db.Find(&options).Error)
	for _, option := range options {
		values[option.Key] = option.Value
	}
	assert.JSONEq(t, `{"User":1,"vip":0.8}`, values["GroupRatio"])
	assert.JSONEq(t, `{"User":"默认分组","vip":"vip分组"}`, values["UserUsableGroups"])
	assert.JSONEq(t, `{"User":{"vip":0.5}}`, values["GroupGroupRatio"])
	assert.JSONEq(t, `{"User":true,"Admin":true}`, values["group_ratio_setting.group_protected"])
	assert.JSONEq(t, `{"User":0.9}`, values["group_ratio_setting.group_user_ratio"])
	assert.JSONEq(t, `{"User":{"vip":"描述"}}`, values["group_ratio_setting.group_special_usable_group"])
	assert.JSONEq(t, `["User","vip"]`, values["AutoGroups"])
	assert.Equal(t, "", values["EmptyOption"])

	// 迁移必须幂等：再跑一次不应产生任何变更。
	require.NoError(t, migrateUserGroupRename(db))
	require.NoError(t, db.First(&user, "username LIKE 'rename-user-%'").Error)
	assert.Equal(t, "User", user.Group)
	require.NoError(t, db.First(&channel, 9001).Error)
	assert.Equal(t, "User,Admin", channel.Group)
	var option Option
	require.NoError(t, db.Where(commonKeyCol+" = ?", "GroupRatio").First(&option).Error)
	assert.JSONEq(t, `{"User":1,"vip":0.8}`, option.Value)
}

func TestMigrateUserGroupRenameSQLite(t *testing.T) {
	truncateTables(t)
	target := openGroupRenameTestDB(t, sqlite.Open(":memory:"), "`group`", "`key`")
	testMigrateUserGroupRename(t, target)
}

func TestMigrateUserGroupRenameMySQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	target := openGroupRenameTestDB(t, mysql.Open(dsn), "`group`", "`key`")
	testMigrateUserGroupRename(t, target)
}

func TestMigrateUserGroupRenamePostgreSQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not configured")
	}
	target := openGroupRenameTestDB(t, postgres.Open(dsn), `"group"`, `"key"`)
	testMigrateUserGroupRename(t, target)
}

func TestUnlimitedGroupWalletIsNotCharged(t *testing.T) {
	truncateTables(t)
	originalUnlimited := ratio_setting.GroupUnlimited2JSONString()
	require.NoError(t, ratio_setting.UpdateGroupUnlimitedByJSONString(`{"Free":true}`))
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateGroupUnlimitedByJSONString(originalUnlimited))
	})

	user := User{
		Username:    "unlimited-user-" + common.GetRandomString(6),
		Password:    "unused-password-hash",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "Free",
		AuthVersion: 1,
		Quota:       1000,
		AffCode:     "unlimited-aff-" + common.GetRandomString(8),
	}
	require.NoError(t, DB.Create(&user).Error)

	reserved, err := TryReserveUserQuota(user.Id, 5000)
	require.NoError(t, err)
	assert.True(t, reserved, "无限额度钱包应当直接放行预扣")

	require.NoError(t, DecreaseUserQuota(user.Id, 5000, false))

	var reloaded User
	require.NoError(t, DB.First(&reloaded, user.Id).Error)
	assert.Equal(t, 1000, reloaded.Quota, "无限额度钱包不应被扣减余额")

	// 消耗仍然照常统计。
	UpdateUserUsedQuotaAndRequestCount(user.Id, 5000)
	require.NoError(t, DB.First(&reloaded, user.Id).Error)
	assert.Equal(t, 5000, reloaded.UsedQuota)
	assert.Equal(t, 1, reloaded.RequestCount)
}
