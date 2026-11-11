package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// useModelSortDB 打开一个只含 models / vendors 表的内存数据库，并接管全局 DB。
func useModelSortDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB := DB

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Model{}, &Vendor{}))
	DB = db
	t.Cleanup(func() {
		DB = previousDB
	})
	return db
}

// TestSearchModelsSortByVendorWithVendorNameFilter 覆盖「按供应商名称过滤 + 按供应商排序」
// 的组合：过滤曾经用 JOIN vendors 实现，而排序又 JOIN 一次同一张表，
// vendors.name 因此变成歧义列，查询直接报错。
func TestSearchModelsSortByVendorWithVendorNameFilter(t *testing.T) {
	db := useModelSortDB(t)
	require.NoError(t, db.Create(&Vendor{Id: 1, Name: "Alpha Inc", Status: 1}).Error)
	require.NoError(t, db.Create(&Vendor{Id: 2, Name: "Beta Ltd", Status: 1}).Error)
	require.NoError(t, db.Create(&Model{Id: 1, ModelName: "m-a1", VendorID: 1, Status: 1, SyncOfficial: 1}).Error)
	require.NoError(t, db.Create(&Model{Id: 2, ModelName: "m-b1", VendorID: 2, Status: 1, SyncOfficial: 1}).Error)

	models, total, err := SearchModels("", "Alpha Inc", "", "", "vendor", "asc", 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, models, 1)
	assert.Equal(t, "m-a1", models[0].ModelName)

	// 供应商名过滤命中多个供应商时，结果按供应商名排序。
	models, total, err = SearchModels("", "Inc", "", "", "vendor", "asc", 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, models, 1)
	assert.Equal(t, "m-a1", models[0].ModelName)
}

// TestSearchModelsSortByVendorOrdersByVendorName 锁定供应商排序的语义：
// 结果顺序由 vendors.name 决定，而不是 models.id。
func TestSearchModelsSortByVendorOrdersByVendorName(t *testing.T) {
	db := useModelSortDB(t)
	require.NoError(t, db.Create(&Vendor{Id: 1, Name: "Zeta Corp", Status: 1}).Error)
	require.NoError(t, db.Create(&Vendor{Id: 2, Name: "Alpha Inc", Status: 1}).Error)
	require.NoError(t, db.Create(&Model{Id: 1, ModelName: "m-z", VendorID: 1, Status: 1, SyncOfficial: 1}).Error)
	require.NoError(t, db.Create(&Model{Id: 2, ModelName: "m-a", VendorID: 2, Status: 1, SyncOfficial: 1}).Error)

	models, _, err := SearchModels("", "", "", "", "vendor", "asc", 0, 10)
	require.NoError(t, err)
	require.Len(t, models, 2)
	assert.Equal(t, "m-a", models[0].ModelName)
	assert.Equal(t, "m-z", models[1].ModelName)

	models, _, err = SearchModels("", "", "", "", "vendor", "desc", 0, 10)
	require.NoError(t, err)
	require.Len(t, models, 2)
	assert.Equal(t, "m-z", models[0].ModelName)
	assert.Equal(t, "m-a", models[1].ModelName)
}

// TestSearchModelsKeywordWithVendorSort 覆盖「关键词搜索 + 按供应商排序」：
// 排序会 JOIN vendors，而 vendors 与 models 都有 description 列，
// 关键词条件不限定表名时 description 就是歧义列。
func TestSearchModelsKeywordWithVendorSort(t *testing.T) {
	db := useModelSortDB(t)
	require.NoError(t, db.Create(&Vendor{Id: 1, Name: "Zeta Corp", Status: 1}).Error)
	require.NoError(t, db.Create(&Vendor{Id: 2, Name: "Alpha Inc", Status: 1}).Error)
	require.NoError(t, db.Create(&Model{Id: 1, ModelName: "m-z", VendorID: 1, Status: 1, SyncOfficial: 1}).Error)
	require.NoError(t, db.Create(&Model{Id: 2, ModelName: "m-a", VendorID: 2, Status: 1, SyncOfficial: 1}).Error)
	require.NoError(t, db.Create(&Model{Id: 3, ModelName: "other", VendorID: 2, Status: 1, SyncOfficial: 1}).Error)

	models, total, err := SearchModels("m", "", "", "", "vendor", "asc", 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, models, 2)
	assert.Equal(t, []string{"m-a", "m-z"},
		[]string{models[0].ModelName, models[1].ModelName})
}

// TestSearchModelsSortByName 锁定按模型名排序，并确认按供应商 ID 过滤仍然可用。
func TestSearchModelsSortByName(t *testing.T) {
	db := useModelSortDB(t)
	require.NoError(t, db.Create(&Vendor{Id: 1, Name: "Alpha Inc", Status: 1}).Error)
	require.NoError(t, db.Create(&Model{Id: 1, ModelName: "m-c", VendorID: 1, Status: 1, SyncOfficial: 1}).Error)
	require.NoError(t, db.Create(&Model{Id: 2, ModelName: "m-a", VendorID: 1, Status: 1, SyncOfficial: 1}).Error)
	require.NoError(t, db.Create(&Model{Id: 3, ModelName: "m-b", VendorID: 1, Status: 1, SyncOfficial: 1}).Error)

	models, _, err := SearchModels("", "", "", "", "name", "asc", 0, 10)
	require.NoError(t, err)
	require.Len(t, models, 3)
	assert.Equal(t, []string{"m-a", "m-b", "m-c"},
		[]string{models[0].ModelName, models[1].ModelName, models[2].ModelName})

	models, total, err := SearchModels("", "1", "", "", "vendor", "asc", 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(3), total)
	assert.Len(t, models, 3)
}
