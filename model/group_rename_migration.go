package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// 默认分组 "default" 改名 "User"，与 "Admin"、"Free" 统一成
// 「首字母大写的英文单词」风格。改名涉及所有存放分组名的列与选项里的分组键，
// 必须整体迁移：漏改一处就会让老令牌 403（分组已弃用）或老渠道 503（无可用渠道）。
const (
	legacyGroupName  = "default"
	renamedGroupName = common.DefaultUserGroup
)

// groupRenameTarget 描述一个存放单个分组名的列。
type groupRenameTarget struct {
	model  any    // 用于表存在性检查与表名解析
	column string // 列名
	quoted string // WHERE 子句里使用的列名，保留字需要按方言加引号
}

// groupRenameOption 描述一个把分组名写在 JSON 里的选项。
type groupRenameOption struct {
	key     string
	nested  bool // true 表示外层键与内层键都是分组名
	isArray bool // true 表示值是分组名数组
}

// migrateUserGroupRename 把存量数据里的旧分组名改名为新分组名。
// 幂等：改名完成后旧名不再出现，再执行一次不会有任何写入。
func migrateUserGroupRename(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("migrate user group rename: database is nil")
	}
	targets := []groupRenameTarget{
		{model: &User{}, column: "group", quoted: commonGroupCol},
		{model: &Token{}, column: "group", quoted: commonGroupCol},
		{model: &Ability{}, column: "group", quoted: commonGroupCol},
		{model: &Task{}, column: "group", quoted: commonGroupCol},
		{model: &PerfMetric{}, column: "group", quoted: commonGroupCol},
		{model: &PerfConcurrency{}, column: "group", quoted: commonGroupCol},
		{model: &QuotaData{}, column: "use_group", quoted: "use_group"},
		{model: &FlowQuotaData{}, column: "use_group", quoted: "use_group"},
		{model: &UserSubscription{}, column: "prev_user_group", quoted: "prev_user_group"},
		{model: &UserSubscription{}, column: "upgrade_group", quoted: "upgrade_group"},
		{model: &UserSubscription{}, column: "downgrade_group", quoted: "downgrade_group"},
		{model: &SubscriptionPlan{}, column: "upgrade_group", quoted: "upgrade_group"},
		{model: &SubscriptionPlan{}, column: "downgrade_group", quoted: "downgrade_group"},
	}
	for _, target := range targets {
		if err := renameGroupColumn(db, target); err != nil {
			return err
		}
	}
	if err := renameChannelGroupList(db); err != nil {
		return err
	}
	return renameGroupOptionKeys(db)
}

// renameGroupColumn 把某一列里等于旧分组名的值改写为新分组名。
// Unscoped 保证软删除的行也会被改名，避免库里残留旧分组名。
func renameGroupColumn(db *gorm.DB, target groupRenameTarget) error {
	if !db.Migrator().HasTable(target.model) {
		return nil
	}
	if !db.Migrator().HasColumn(target.model, target.column) {
		return nil
	}
	result := db.Unscoped().Model(target.model).
		Where(target.quoted+" = ?", legacyGroupName).
		Update(target.column, renamedGroupName)
	if result.Error != nil {
		return fmt.Errorf("rename group column %s: %w", target.column, result.Error)
	}
	return nil
}

// renameChannelGroupList 改写渠道的分组列表。渠道的分组是逗号分隔的多值，
// 必须按段替换：用 SQL REPLACE 会把 "notdefault" 误伤成 "notUser"。
func renameChannelGroupList(db *gorm.DB) error {
	if !db.Migrator().HasTable(&Channel{}) {
		return nil
	}
	var channels []Channel
	err := db.Unscoped().Model(&Channel{}).
		Select("id", "group").
		Where(commonGroupCol+" LIKE ?", "%"+legacyGroupName+"%").
		Find(&channels).Error
	if err != nil {
		return fmt.Errorf("load channels for group rename: %w", err)
	}
	for _, channel := range channels {
		renamed, changed := renameGroupList(channel.Group)
		if !changed {
			continue
		}
		if err := db.Unscoped().Model(&Channel{}).Where("id = ?", channel.Id).Update("group", renamed).Error; err != nil {
			return fmt.Errorf("rename group list of channel %d: %w", channel.Id, err)
		}
	}
	return nil
}

// renameGroupList 按逗号分段替换分组名，返回替换后的列表与是否发生替换。
func renameGroupList(groups string) (string, bool) {
	if groups == "" {
		return groups, false
	}
	parts := strings.Split(groups, ",")
	changed := false
	for i, part := range parts {
		if part == legacyGroupName {
			parts[i] = renamedGroupName
			changed = true
		}
	}
	if !changed {
		return groups, false
	}
	return strings.Join(parts, ","), true
}

// renameGroupOptionKeys 改写选项 JSON 里出现的分组键。
// 空字符串视为空集（沿用空串语义），不报错也不写入。
func renameGroupOptionKeys(db *gorm.DB) error {
	if !db.Migrator().HasTable(&Option{}) {
		return nil
	}
	options := []groupRenameOption{
		{key: "GroupRatio"},
		{key: "UserUsableGroups"},
		{key: "group_ratio_setting.group_protected"},
		{key: "group_ratio_setting.group_user_ratio"},
		{key: "GroupGroupRatio", nested: true},
		{key: "group_ratio_setting.group_special_usable_group", nested: true},
		{key: "AutoGroups", isArray: true},
	}
	for _, option := range options {
		var stored Option
		err := db.Model(&Option{}).Where(commonKeyCol+" = ?", option.key).First(&stored).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return fmt.Errorf("load option %s for group rename: %w", option.key, err)
		}
		renamed, changed, err := renameGroupOptionValue(stored.Value, option)
		if err != nil {
			common.SysError(fmt.Sprintf("failed to rename group keys in option %s: %s", option.key, err.Error()))
			continue
		}
		if !changed {
			continue
		}
		if err := db.Model(&Option{}).Where(commonKeyCol+" = ?", option.key).Update("value", renamed).Error; err != nil {
			return fmt.Errorf("update option %s for group rename: %w", option.key, err)
		}
	}
	return nil
}

// renameGroupOptionValue 按选项的形状改写分组名。
func renameGroupOptionValue(value string, option groupRenameOption) (string, bool, error) {
	if strings.TrimSpace(value) == "" {
		return value, false, nil
	}
	if option.isArray {
		return renameGroupNameArray(value)
	}
	if option.nested {
		return renameGroupNameNestedMap(value)
	}
	return renameGroupNameFlatMap(value)
}

// renameGroupNameFlatMap 改写「分组名 → 值」这种对象里的键。
func renameGroupNameFlatMap(value string) (string, bool, error) {
	var entries map[string]json.RawMessage
	if err := common.Unmarshal([]byte(value), &entries); err != nil {
		return value, false, err
	}
	if _, ok := entries[legacyGroupName]; !ok {
		return value, false, nil
	}
	renamed := make(map[string]json.RawMessage, len(entries))
	for key, raw := range entries {
		if key == legacyGroupName {
			key = renamedGroupName
		}
		renamed[key] = raw
	}
	marshaled, err := common.Marshal(renamed)
	if err != nil {
		return value, false, err
	}
	return string(marshaled), true, nil
}

// renameGroupNameNestedMap 改写「用户分组 → {令牌分组: 值}」这种嵌套对象里的键。
func renameGroupNameNestedMap(value string) (string, bool, error) {
	var entries map[string]json.RawMessage
	if err := common.Unmarshal([]byte(value), &entries); err != nil {
		return value, false, err
	}
	renamed := make(map[string]json.RawMessage, len(entries))
	changed := false
	for key, raw := range entries {
		inner, innerChanged, err := renameGroupNameFlatMap(string(raw))
		if err != nil {
			return value, false, err
		}
		if innerChanged {
			changed = true
			raw = json.RawMessage(inner)
		}
		if key == legacyGroupName {
			key = renamedGroupName
			changed = true
		}
		renamed[key] = raw
	}
	if !changed {
		return value, false, nil
	}
	marshaled, err := common.Marshal(renamed)
	if err != nil {
		return value, false, err
	}
	return string(marshaled), true, nil
}

// renameGroupNameArray 改写分组名数组里的元素。
func renameGroupNameArray(value string) (string, bool, error) {
	var names []string
	if err := common.Unmarshal([]byte(value), &names); err != nil {
		return value, false, err
	}
	changed := false
	for i, name := range names {
		if name == legacyGroupName {
			names[i] = renamedGroupName
			changed = true
		}
	}
	if !changed {
		return value, false, nil
	}
	marshaled, err := common.Marshal(names)
	if err != nil {
		return value, false, err
	}
	return string(marshaled), true, nil
}

// migrateLogGroupRename 改写日志库里的分组名。
// ClickHouse 的日志库用 ALTER TABLE ... UPDATE 语法，且历史日志的分组名只影响
// 展示，不影响功能，因此直接跳过。
func migrateLogGroupRename(db *gorm.DB) error {
	if db == nil {
		return nil
	}
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		return nil
	}
	return renameGroupColumn(db, groupRenameTarget{
		model:  &Log{},
		column: "group",
		quoted: logGroupCol,
	})
}
