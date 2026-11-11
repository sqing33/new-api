package ratio_setting

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/types"
)

var defaultGroupRatio = map[string]float64{
	common.DefaultUserGroup:      1,
	"vip":                        1,
	"svip":                       1,
	common.DefaultRootGroup:      1,
	common.DefaultUnlimitedGroup: 1,
}

var groupRatioMap = types.NewRWMap[string, float64]()

var defaultGroupGroupRatio = map[string]map[string]float64{}

var groupGroupRatioMap = types.NewRWMap[string, map[string]float64]()

var defaultGroupSpecialUsableGroup = map[string]map[string]string{}

// defaultGroupProtected 列出默认受保护的分组。受保护分组仅供本组用户使用，
// 管理员无需为每个用户分组逐条配置特殊可用分组规则。
var defaultGroupProtected = map[string]bool{
	common.DefaultRootGroup: true,
}

var groupProtectedMap = types.NewRWMap[string, bool]()

// defaultGroupUserRatio 列出默认的用户分组倍率（乘数，0.8 表示八折）。
// 默认不预设任何折扣，由管理员按需配置。
var defaultGroupUserRatio = map[string]float64{}

var groupUserRatioMap = types.NewRWMap[string, float64]()

// defaultGroupUnlimited 列出默认的无限额度分组。无限额度分组成员的余额被
// 置为 common.UnlimitedQuota，消耗照常统计但不受限制。
// Admin（超级管理员分组）与 Free 一样默认不限额，站点所有者不受自己的余额限制。
var defaultGroupUnlimited = map[string]bool{
	common.DefaultUnlimitedGroup: true,
	common.DefaultRootGroup:      true,
}

var groupUnlimitedMap = types.NewRWMap[string, bool]()

type GroupRatioSetting struct {
	GroupRatio              *types.RWMap[string, float64]            `json:"group_ratio"`
	GroupGroupRatio         *types.RWMap[string, map[string]float64] `json:"group_group_ratio"`
	GroupSpecialUsableGroup *types.RWMap[string, map[string]string]  `json:"group_special_usable_group"`
	GroupProtected          *types.RWMap[string, bool]               `json:"group_protected"`
	GroupUserRatio          *types.RWMap[string, float64]            `json:"group_user_ratio"`
	GroupUnlimited          *types.RWMap[string, bool]               `json:"group_unlimited"`
}

var groupRatioSetting GroupRatioSetting

func init() {
	groupSpecialUsableGroup := types.NewRWMap[string, map[string]string]()
	groupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)

	groupRatioMap.AddAll(defaultGroupRatio)
	groupGroupRatioMap.AddAll(defaultGroupGroupRatio)
	groupProtectedMap.AddAll(defaultGroupProtected)
	groupUserRatioMap.AddAll(defaultGroupUserRatio)
	groupUnlimitedMap.AddAll(defaultGroupUnlimited)

	groupRatioSetting = GroupRatioSetting{
		GroupSpecialUsableGroup: groupSpecialUsableGroup,
		GroupRatio:              groupRatioMap,
		GroupGroupRatio:         groupGroupRatioMap,
		GroupProtected:          groupProtectedMap,
		GroupUserRatio:          groupUserRatioMap,
		GroupUnlimited:          groupUnlimitedMap,
	}

	config.GlobalConfig.Register("group_ratio_setting", &groupRatioSetting)
}

func GetGroupRatioSetting() *GroupRatioSetting {
	if groupRatioSetting.GroupSpecialUsableGroup == nil {
		groupRatioSetting.GroupSpecialUsableGroup = types.NewRWMap[string, map[string]string]()
		groupRatioSetting.GroupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)
	}
	if groupRatioSetting.GroupProtected == nil {
		groupRatioSetting.GroupProtected = groupProtectedMap
	}
	if groupRatioSetting.GroupUserRatio == nil {
		groupRatioSetting.GroupUserRatio = groupUserRatioMap
	}
	if groupRatioSetting.GroupUnlimited == nil {
		groupRatioSetting.GroupUnlimited = groupUnlimitedMap
	}
	return &groupRatioSetting
}

func GetGroupRatioCopy() map[string]float64 {
	return groupRatioMap.ReadAll()
}

func ContainsGroupRatio(name string) bool {
	_, ok := groupRatioMap.Get(name)
	return ok
}

func GroupRatio2JSONString() string {
	return groupRatioMap.MarshalJSONString()
}

func UpdateGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupRatioMap, jsonStr)
}

func GetGroupRatio(name string) float64 {
	ratio, ok := groupRatioMap.Get(name)
	if !ok {
		common.SysLog("group ratio not found: " + name)
		return 1
	}
	return ratio
}

func GetGroupGroupRatio(userGroup, usingGroup string) (float64, bool) {
	gp, ok := groupGroupRatioMap.Get(userGroup)
	if !ok {
		return -1, false
	}
	ratio, ok := gp[usingGroup]
	if !ok {
		return -1, false
	}
	return ratio, true
}

func GroupGroupRatio2JSONString() string {
	return groupGroupRatioMap.MarshalJSONString()
}

func UpdateGroupGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupGroupRatioMap, jsonStr)
}

// IsGroupProtected 判断分组是否受保护。受保护分组仅供本组用户使用，
// 管理员无需为每个用户分组逐条配置特殊可用分组规则。
func IsGroupProtected(group string) bool {
	protected, ok := groupProtectedMap.Get(group)
	return ok && protected
}

// GetUserGroupRatio 返回用户分组的折扣倍率（乘数），未配置时返回 false。
func GetUserGroupRatio(userGroup string) (float64, bool) {
	return groupUserRatioMap.Get(userGroup)
}

// IsGroupUnlimited 判断分组是否为无限额度分组。无限额度分组成员的余额被
// 置为 common.UnlimitedQuota，消耗照常统计但不受限制。
func IsGroupUnlimited(group string) bool {
	unlimited, ok := groupUnlimitedMap.Get(group)
	return ok && unlimited
}

// EnsureUnlimitedGroupsInRatio 保证被标记为无限额度的分组同时存在于分组倍率表中，
// 缺失的分组以倍率 1 补齐，返回是否发生了补齐。
// 存量安装的 GroupRatio 选项是整体覆盖代码默认值的，代码默认里带的无限额度分组
// （如 Free）会因此从倍率表中消失：它仍被标记为无限额度，却无法分配给任何用户。
func EnsureUnlimitedGroupsInRatio() bool {
	changed := false
	for name, unlimited := range groupUnlimitedMap.ReadAll() {
		if !unlimited {
			continue
		}
		if _, exists := groupRatioMap.Get(name); exists {
			continue
		}
		groupRatioMap.Set(name, 1)
		changed = true
	}
	return changed
}

// ResolveGroupRatio 计算一次请求最终生效的分组倍率。
// 优先级：分组特殊倍率（用户分组 × 令牌分组，覆盖语义）> 令牌分组倍率 × 用户分组倍率。
// 用户分组倍率是乘数而非覆盖值，因此用户既享受身份折扣，也保留令牌分组自身的优惠。
func ResolveGroupRatio(userGroup, usingGroup string) types.GroupRatioInfo {
	result := types.GroupRatioInfo{
		GroupSpecialRatio: -1,
		UserGroupRatio:    1,
	}
	if specialRatio, ok := GetGroupGroupRatio(userGroup, usingGroup); ok {
		result.GroupSpecialRatio = specialRatio
		result.GroupRatio = specialRatio
		result.HasSpecialRatio = true
		return result
	}
	result.GroupRatio = GetGroupRatio(usingGroup)
	if userRatio, ok := GetUserGroupRatio(userGroup); ok {
		result.UserGroupRatio = userRatio
		result.HasUserGroupRatio = true
		result.GroupRatio *= userRatio
	}
	return result
}

// GroupProtected2JSONString 导出受保护分组配置。
func GroupProtected2JSONString() string {
	return groupProtectedMap.MarshalJSONString()
}

// UpdateGroupProtectedByJSONString 覆盖受保护分组配置。
func UpdateGroupProtectedByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupProtectedMap, jsonStr)
}

// GroupUserRatio2JSONString 导出用户分组倍率配置。
func GroupUserRatio2JSONString() string {
	return groupUserRatioMap.MarshalJSONString()
}

// UpdateGroupUserRatioByJSONString 覆盖用户分组倍率配置。
func UpdateGroupUserRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupUserRatioMap, jsonStr)
}

// GroupUnlimited2JSONString 导出无限额度分组配置。
func GroupUnlimited2JSONString() string {
	return groupUnlimitedMap.MarshalJSONString()
}

// UpdateGroupUnlimitedByJSONString 覆盖无限额度分组配置。
func UpdateGroupUnlimitedByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupUnlimitedMap, jsonStr)
}

func CheckGroupRatio(jsonStr string) error {
	if strings.TrimSpace(jsonStr) == "" {
		return nil
	}
	checkGroupRatio := make(map[string]float64)
	err := common.Unmarshal([]byte(jsonStr), &checkGroupRatio)
	if err != nil {
		return err
	}
	for name, ratio := range checkGroupRatio {
		if ratio < 0 {
			return errors.New("group ratio must be not less than 0: " + name)
		}
	}
	return nil
}

// CheckGroupUserRatio 校验用户分组倍率配置：必须是对象，且倍率不小于 0。
func CheckGroupUserRatio(jsonStr string) error {
	if strings.TrimSpace(jsonStr) == "" {
		return nil
	}
	checkUserGroupRatio := make(map[string]float64)
	if err := common.Unmarshal([]byte(jsonStr), &checkUserGroupRatio); err != nil {
		return err
	}
	for name, ratio := range checkUserGroupRatio {
		if ratio < 0 {
			return errors.New("user group ratio must be not less than 0: " + name)
		}
	}
	return nil
}

// CheckGroupUnlimited 校验无限额度分组配置：必须是「分组名 → true/false」的对象。
func CheckGroupUnlimited(jsonStr string) error {
	if strings.TrimSpace(jsonStr) == "" {
		return nil
	}
	checkGroupUnlimited := make(map[string]bool)
	if err := common.Unmarshal([]byte(jsonStr), &checkGroupUnlimited); err != nil {
		return err
	}
	return nil
}
