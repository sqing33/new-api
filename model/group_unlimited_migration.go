package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	groupUnlimitedOptionKey = "group_ratio_setting.group_unlimited"
	// adminUnlimitedMigrationMarkerKey 记录「Admin 分组已补进无限额度配置」这一步
	// 已经执行过。管理员之后取消勾选不会再被补回。
	adminUnlimitedMigrationMarkerKey = "group_ratio_setting.admin_unlimited_migrated"
)

// migrateAdminUnlimitedGroup 把超级管理员分组补进已经存在的无限额度分组配置。
//
// 代码默认值（defaultGroupUnlimited）只在选项表没有该键时生效：存量安装的选项行
// 是整份 JSON 覆盖的，上一次保存时只勾了 Free，Admin 就永远拿不到无限额度。
// 该迁移在选项载入内存前执行，改写后的配置由 InitOptionMap 直接读到。
func migrateAdminUnlimitedGroup(db *gorm.DB) error {
	if db == nil {
		return errors.New("migrate admin unlimited group: database is nil")
	}
	if !db.Migrator().HasTable(&Option{}) {
		return nil
	}

	var marker Option
	err := db.Where(&Option{Key: adminUnlimitedMigrationMarkerKey}).First(&marker).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("read admin unlimited migration marker: %w", err)
	}

	var stored Option
	err = db.Where(&Option{Key: groupUnlimitedOptionKey}).First(&stored).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// 没有配置行时使用的是代码默认值，其中已经包含 Admin。
		return db.Create(&Option{Key: adminUnlimitedMigrationMarkerKey, Value: "true"}).Error
	}
	if err != nil {
		return fmt.Errorf("read group unlimited option: %w", err)
	}

	unlimited := make(map[string]bool)
	if strings.TrimSpace(stored.Value) != "" {
		if err := common.Unmarshal([]byte(stored.Value), &unlimited); err != nil {
			// 配置本身损坏时交给设置页人工处理，避免在这里写出半份配置。
			common.SysError("skipped admin unlimited group migration, existing value is invalid: " + err.Error())
			return db.Create(&Option{Key: adminUnlimitedMigrationMarkerKey, Value: "true"}).Error
		}
	}
	if unlimited[common.DefaultRootGroup] {
		return db.Create(&Option{Key: adminUnlimitedMigrationMarkerKey, Value: "true"}).Error
	}

	unlimited[common.DefaultRootGroup] = true
	encoded, err := common.Marshal(unlimited)
	if err != nil {
		return fmt.Errorf("encode group unlimited option: %w", err)
	}
	migrated := string(encoded)
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Option{}).Where(&Option{Key: groupUnlimitedOptionKey}).Update("value", migrated).Error; err != nil {
			return fmt.Errorf("add admin to group unlimited option: %w", err)
		}
		return tx.Create(&Option{Key: adminUnlimitedMigrationMarkerKey, Value: "true"}).Error
	})
}
