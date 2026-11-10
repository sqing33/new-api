package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// configureGroupProtectionTest 固定分组相关配置，并在用例结束后完整还原。
func configureGroupProtectionTest(t *testing.T) {
	t.Helper()
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	originalSpecialRatios := ratio_setting.GroupGroupRatio2JSONString()
	originalProtected := ratio_setting.GroupProtected2JSONString()
	originalUserRatio := ratio_setting.GroupUserRatio2JSONString()
	originalUnlimited := ratio_setting.GroupUnlimited2JSONString()
	originalAutoGroups := setting.AutoGroups2JsonString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"User":"Default","vip":"VIP","Admin":"Admin"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"User":1,"vip":1,"GPT":0.3,"Admin":1}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{}`))
	require.NoError(t, ratio_setting.UpdateGroupProtectedByJSONString(`{"Admin":true}`))
	require.NoError(t, ratio_setting.UpdateGroupUserRatioByJSONString(`{}`))
	require.NoError(t, ratio_setting.UpdateGroupUnlimitedByJSONString(`{"Free":true}`))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["User"]`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
		require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(originalSpecialRatios))
		require.NoError(t, ratio_setting.UpdateGroupProtectedByJSONString(originalProtected))
		require.NoError(t, ratio_setting.UpdateGroupUserRatioByJSONString(originalUserRatio))
		require.NoError(t, ratio_setting.UpdateGroupUnlimitedByJSONString(originalUnlimited))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(originalAutoGroups))
	})
}

func TestGetUserUsableGroupsHidesProtectedGroupFromNonMembers(t *testing.T) {
	configureGroupProtectionTest(t)

	usable := GetUserUsableGroups("User", common.RoleCommonUser)

	assert.NotContains(t, usable, "Admin")
	assert.Contains(t, usable, "User")
	assert.Contains(t, usable, "vip")
}

func TestGetUserUsableGroupsKeepsProtectedGroupForMembers(t *testing.T) {
	configureGroupProtectionTest(t)

	usable := GetUserUsableGroups("Admin", common.RoleCommonUser)

	assert.Contains(t, usable, "Admin")
	assert.Contains(t, usable, "User")
}

func TestGetUserUsableGroupsRootIsNotBlockedByProtectedGroup(t *testing.T) {
	configureGroupProtectionTest(t)

	usable := GetUserUsableGroups("User", common.RoleRootUser)

	assert.Contains(t, usable, "Admin")
}

func TestSpecialUsableGroupCannotLeakProtectedGroup(t *testing.T) {
	configureGroupProtectionTest(t)
	special := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup
	require.NoError(t, types.LoadFromJsonString(special, `{"User":{"+:Admin":"管理员分组"}}`))

	usable := GetUserUsableGroups("User", common.RoleCommonUser)

	assert.NotContains(t, usable, "Admin")
}

func TestIsUserSelectableGroupRespectsProtectedGroupMembership(t *testing.T) {
	configureGroupProtectionTest(t)

	assert.False(t, IsUserSelectableGroup("User", common.RoleCommonUser, "Admin"))
	assert.True(t, IsUserSelectableGroup("Admin", common.RoleCommonUser, "Admin"))
	assert.True(t, IsUserSelectableGroup("User", common.RoleRootUser, "Admin"))
}

func TestGetUserAutoGroupSkipsProtectedGroupForNonMembers(t *testing.T) {
	configureGroupProtectionTest(t)
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["User","Admin"]`))

	assert.Equal(t, []string{"User"}, GetUserAutoGroup("User", common.RoleCommonUser))
	assert.Equal(t, []string{"User", "Admin"}, GetUserAutoGroup("Admin", common.RoleCommonUser))
}

func TestResolveGroupRatioMultipliesUserGroupRatio(t *testing.T) {
	configureGroupProtectionTest(t)
	require.NoError(t, ratio_setting.UpdateGroupUserRatioByJSONString(`{"vip":0.8,"svip":0.5}`))

	vipDefault := ratio_setting.ResolveGroupRatio("vip", "User")
	assert.Equal(t, 0.8, vipDefault.GroupRatio)
	assert.True(t, vipDefault.HasUserGroupRatio)
	assert.Equal(t, 0.8, vipDefault.UserGroupRatio)
	assert.False(t, vipDefault.HasSpecialRatio)

	vipGPT := ratio_setting.ResolveGroupRatio("vip", "GPT")
	assert.InDelta(t, 0.24, vipGPT.GroupRatio, 1e-9)

	svipDefault := ratio_setting.ResolveGroupRatio("svip", "User")
	assert.Equal(t, 0.5, svipDefault.GroupRatio)
}

func TestResolveGroupRatioSpecialRatioOverridesUserGroupRatio(t *testing.T) {
	configureGroupProtectionTest(t)
	require.NoError(t, ratio_setting.UpdateGroupUserRatioByJSONString(`{"vip":0.8}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"vip":{"User":0.5}}`))

	resolved := ratio_setting.ResolveGroupRatio("vip", "User")

	assert.Equal(t, 0.5, resolved.GroupRatio)
	assert.True(t, resolved.HasSpecialRatio)
	assert.Equal(t, 0.5, resolved.GroupSpecialRatio)
	assert.False(t, resolved.HasUserGroupRatio)
}

func TestGetUserGroupRatioReturnsEffectiveRatio(t *testing.T) {
	configureGroupProtectionTest(t)
	require.NoError(t, ratio_setting.UpdateGroupUserRatioByJSONString(`{"vip":0.8}`))

	assert.Equal(t, 0.8, GetUserGroupRatio("vip", "User"))
	assert.Equal(t, 1.0, GetUserGroupRatio("User", "User"))
}

func TestEmptyStringOptionClearsCollectionWithoutError(t *testing.T) {
	configureGroupProtectionTest(t)

	require.NoError(t, setting.UpdateAutoGroupsByJsonString(""))
	assert.Empty(t, setting.GetAutoGroups())

	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(""))
	_, hasSpecial := ratio_setting.GetGroupGroupRatio("vip", "User")
	assert.False(t, hasSpecial)

	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(""))
	assert.Empty(t, setting.GetUserUsableGroupsCopy())

	require.NoError(t, ratio_setting.UpdateGroupUnlimitedByJSONString(""))
	assert.False(t, ratio_setting.IsGroupUnlimited("Free"))
}

func TestIsGroupUnlimitedReadsConfiguredGroups(t *testing.T) {
	configureGroupProtectionTest(t)

	assert.True(t, ratio_setting.IsGroupUnlimited("Free"))
	assert.False(t, ratio_setting.IsGroupUnlimited("User"))
	assert.False(t, ratio_setting.IsGroupUnlimited("Admin"))
}

func TestInvalidJSONOptionIsRejected(t *testing.T) {
	configureGroupProtectionTest(t)

	assert.Error(t, setting.UpdateAutoGroupsByJsonString("{invalid"))
	assert.Error(t, ratio_setting.UpdateGroupGroupRatioByJSONString("{invalid"))
	assert.Error(t, ratio_setting.CheckGroupUserRatio(`{"vip":-1}`))
	assert.Error(t, ratio_setting.CheckGroupUnlimited(`{invalid`))
}
