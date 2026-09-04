package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const prefillGroupNameIndex = "uk_prefill_name"
const legacyPrefillGroupNameUnique = "idx_prefill_groups_name"

type conflictingPrefillGroupUniqueness struct {
	constraints []string
	indexes     []string
}

type prefillGroupNameIndexState struct {
	exists bool
	valid  bool
}

func (conflicts conflictingPrefillGroupUniqueness) empty() bool {
	return len(conflicts.constraints) == 0 && len(conflicts.indexes) == 0
}

func (conflicts conflictingPrefillGroupUniqueness) validateAutomaticMigrationScope() error {
	unexpectedConstraints := make([]string, 0)
	for _, name := range conflicts.constraints {
		if name != legacyPrefillGroupNameUnique {
			unexpectedConstraints = append(unexpectedConstraints, name)
		}
	}
	unexpectedIndexes := make([]string, 0)
	for _, name := range conflicts.indexes {
		if name != legacyPrefillGroupNameUnique {
			unexpectedIndexes = append(unexpectedIndexes, name)
		}
	}
	if len(unexpectedConstraints) == 0 && len(unexpectedIndexes) == 0 {
		return nil
	}
	return fmt.Errorf(
		"prefill_groups.name has unsupported global unique constraints %q and indexes %q; only legacy object %q can be migrated automatically to partial uniqueness",
		unexpectedConstraints,
		unexpectedIndexes,
		legacyPrefillGroupNameUnique,
	)
}

func inspectConflictingPrefillGroupUniqueness(db *gorm.DB, tableName string) (conflictingPrefillGroupUniqueness, error) {
	var conflicts conflictingPrefillGroupUniqueness
	if err := db.Raw(`
SELECT constraint_meta.conname
FROM pg_catalog.pg_constraint AS constraint_meta
WHERE constraint_meta.conrelid = to_regclass(?)
  AND constraint_meta.contype = 'u'
  AND cardinality(constraint_meta.conkey) = 1
  AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_meta
      WHERE attribute_meta.attrelid = constraint_meta.conrelid
        AND attribute_meta.attnum = constraint_meta.conkey[1]
        AND attribute_meta.attname = ?
  )
ORDER BY constraint_meta.conname`, tableName, "name").Scan(&conflicts.constraints).Error; err != nil {
		return conflicts, fmt.Errorf("inspect conflicting prefill group unique constraints: %w", err)
	}

	if err := db.Raw(`
SELECT index_class.relname
FROM pg_catalog.pg_index AS index_meta
JOIN pg_catalog.pg_class AS index_class
  ON index_class.oid = index_meta.indexrelid
JOIN pg_catalog.pg_attribute AS attribute_meta
  ON attribute_meta.attrelid = index_meta.indrelid
 AND attribute_meta.attnum = index_meta.indkey[0]
WHERE index_meta.indrelid = to_regclass(?)
  AND index_meta.indisunique
  AND NOT index_meta.indisprimary
  AND index_meta.indpred IS NULL
  AND index_meta.indexprs IS NULL
  AND index_meta.indnatts = 1
  AND attribute_meta.attname = ?
  AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_meta
      WHERE constraint_meta.conindid = index_meta.indexrelid
  )
ORDER BY index_class.relname`, tableName, "name").Scan(&conflicts.indexes).Error; err != nil {
		return conflicts, fmt.Errorf("inspect conflicting prefill group unique indexes: %w", err)
	}

	return conflicts, nil
}

func inspectPrefillGroupNameIndex(db *gorm.DB, tableName string) (prefillGroupNameIndexState, error) {
	var state struct {
		Exists bool `gorm:"column:index_exists"`
		Valid  bool `gorm:"column:index_valid"`
	}
	if err := db.Raw(`
SELECT count(*) > 0 AS index_exists,
       COALESCE(bool_or(
           index_meta.indisunique
           AND index_meta.indisvalid
           AND index_meta.indisready
           AND NOT index_meta.indisprimary
           AND index_meta.indexprs IS NULL
           AND index_meta.indnatts = 1
           AND attribute_meta.attname = ?
           AND pg_get_expr(index_meta.indpred, index_meta.indrelid) = '(deleted_at IS NULL)'
       ), false) AS index_valid
FROM pg_catalog.pg_index AS index_meta
JOIN pg_catalog.pg_class AS index_class
  ON index_class.oid = index_meta.indexrelid
LEFT JOIN pg_catalog.pg_attribute AS attribute_meta
  ON attribute_meta.attrelid = index_meta.indrelid
 AND attribute_meta.attnum = index_meta.indkey[0]
WHERE index_meta.indrelid = to_regclass(?)
  AND index_class.relname = ?`, "name", tableName, prefillGroupNameIndex).Scan(&state).Error; err != nil {
		return prefillGroupNameIndexState{}, fmt.Errorf("inspect prefill group partial unique index: %w", err)
	}
	return prefillGroupNameIndexState{exists: state.Exists, valid: state.Valid}, nil
}

// migratePrefillGroupUniqueness replaces the known global PostgreSQL unique
// object left by older GORM versions before AutoMigrate inspects the column.
// Unknown conflicting objects are reported without being modified.
func migratePrefillGroupUniqueness(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("migrate prefill group uniqueness: database is nil")
	}
	if db.Dialector.Name() != "postgres" {
		// MySQL/SQLite 由 dropLegacyPrefillGroupIndexesIfPresent 走"只删已知 legacy 名"语义
		return dropLegacyPrefillGroupIndexesIfPresent(db)
	}

	statement := &gorm.Statement{DB: db}
	if err := statement.Parse(&PrefillGroup{}); err != nil {
		return fmt.Errorf("parse prefill group schema: %w", err)
	}
	tableName := statement.Schema.Table
	conflicts, err := inspectConflictingPrefillGroupUniqueness(db, tableName)
	if err != nil {
		return err
	}
	if conflicts.empty() {
		return nil
	}
	if err := conflicts.validateAutomaticMigrationScope(); err != nil {
		return err
	}

	return db.Transaction(func(tx *gorm.DB) error {
		migrator := tx.Migrator()
		if !migrator.HasTable(&PrefillGroup{}) {
			return nil
		}

		common.SysLog(fmt.Sprintf(
			"prefill_groups uniqueness migration: acquiring ACCESS EXCLUSIVE lock on %s (this can take a while on a hot DB; all reads/writes will block until done)",
			tableName,
		))
		if err := tx.Exec(
			"LOCK TABLE ? IN ACCESS EXCLUSIVE MODE",
			clause.Table{Name: tableName},
		).Error; err != nil {
			return fmt.Errorf("lock prefill groups for uniqueness migration: %w", err)
		}

		conflicts, err := inspectConflictingPrefillGroupUniqueness(tx, tableName)
		if err != nil {
			return err
		}
		if conflicts.empty() {
			return nil
		}
		if err := conflicts.validateAutomaticMigrationScope(); err != nil {
			return err
		}

		if !migrator.HasColumn(&PrefillGroup{}, "DeletedAt") {
			if err := migrator.AddColumn(&PrefillGroup{}, "DeletedAt"); err != nil {
				return fmt.Errorf("add prefill groups deleted_at column: %w", err)
			}
		}

		targetIndex, err := inspectPrefillGroupNameIndex(tx, tableName)
		if err != nil {
			return err
		}
		if !targetIndex.exists {
			if err := migrator.CreateIndex(&PrefillGroup{}, prefillGroupNameIndex); err != nil {
				return fmt.Errorf("create prefill group partial unique index: %w", err)
			}
			targetIndex, err = inspectPrefillGroupNameIndex(tx, tableName)
			if err != nil {
				return err
			}
		}
		if !targetIndex.valid {
			return fmt.Errorf("prefill group index %q has an unexpected definition", prefillGroupNameIndex)
		}

		for _, constraintName := range conflicts.constraints {
			if err := migrator.DropConstraint(&PrefillGroup{}, constraintName); err != nil {
				return fmt.Errorf("drop conflicting prefill group constraint %q: %w", constraintName, err)
			}
		}
		for _, indexName := range conflicts.indexes {
			if err := migrator.DropIndex(&PrefillGroup{}, indexName); err != nil {
				return fmt.Errorf("drop conflicting prefill group index %q: %w", indexName, err)
			}
		}

		return nil
	})
}

// dropLegacyPrefillGroupIndexesIfPresent 在 MySQL/SQLite 上把可能遗留的
// legacy 全局唯一索引/约束删掉(只动已知 legacy 名,不误删用户自建)。
// PostgreSQL 路径由 migratePrefillGroupUniqueness 主分支处理。
func dropLegacyPrefillGroupIndexesIfPresent(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("drop legacy prefill group indexes: database is nil")
	}
	if !db.Migrator().HasTable(&PrefillGroup{}) {
		return nil
	}
	migrator := db.Migrator()
	hasIndex, err := hasLegacyPrefillGroupIndex(db, migrator)
	if err != nil {
		return err
	}
	if !hasIndex {
		return nil
	}
	common.SysLog(fmt.Sprintf("dropping legacy prefill_groups index %q (%s)",
		legacyPrefillGroupNameUnique, db.Dialector.Name()))
	if err := migrator.DropIndex(&PrefillGroup{}, legacyPrefillGroupNameUnique); err != nil {
		return fmt.Errorf("drop legacy prefill_groups index: %w", err)
	}
	return nil
}

// hasLegacyPrefillGroupIndex 用方言元数据判断 legacy 全局唯一索引是否还在。
// MySQL 走 information_schema.statistics,SQLite 走 pragma index_list/index_info。
func hasLegacyPrefillGroupIndex(db *gorm.DB, migrator gorm.Migrator) (bool, error) {
	switch db.Dialector.Name() {
	case "mysql":
		var count int64
		if err := db.Raw(
			`SELECT COUNT(*) FROM information_schema.statistics
			 WHERE table_schema = DATABASE() AND table_name = 'prefill_groups' AND index_name = ?`,
			legacyPrefillGroupNameUnique,
		).Scan(&count).Error; err != nil {
			return false, fmt.Errorf("inspect prefill_groups index: %w", err)
		}
		return count > 0, nil
	case "sqlite":
		var rows []struct {
			Name string `gorm:"column:name"`
		}
		if err := db.Raw(`PRAGMA index_list(prefill_groups)`).Scan(&rows).Error; err != nil {
			return false, fmt.Errorf("inspect prefill_groups index: %w", err)
		}
		for _, r := range rows {
			if r.Name == legacyPrefillGroupNameUnique {
				return true, nil
			}
		}
		return false, nil
	default:
		return false, nil
	}
}
