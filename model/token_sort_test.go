package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 令牌列表支持多级排序：SortBy 是逗号分隔的排序链，Apply 按顺序追加 ORDER BY。
// 这里锁定链的解析规则——顺序保持、去重、长度受限、非法维度被丢弃，
// 以及各级维度各自的方向。

func TestTokenSortLevelsParsing(t *testing.T) {
	cases := []struct {
		name   string
		sortBy string
		order  string
		want   []sortLevel
	}{
		{"空串回落到默认链", "", "desc", defaultTokenSortLevels()},
		{"全部非法回落到默认链", "drop_table", "desc", defaultTokenSortLevels()},
		// 单级排序尊重显式方向
		{"单级 name 升序", "name", "asc", []sortLevel{{column: "name", asc: true}}},
		{"单级 name 降序", "name", "desc", []sortLevel{{column: "name", asc: false}}},
		{"单级 concurrency 降序", "concurrency", "desc", []sortLevel{{column: "concurrency", asc: false}}},
		{"单级 group 升序", "group", "asc", []sortLevel{{column: "group", asc: true}}},
		// 多级排序各级用自然方向，忽略全局 sort_order
		{"两级各自自然方向", "name,concurrency", "desc", []sortLevel{
			{column: "name", asc: true}, {column: "concurrency", asc: false},
		}},
		{"顺序敏感", "concurrency,name", "desc", []sortLevel{
			{column: "concurrency", asc: false}, {column: "name", asc: true},
		}},
		{"多级忽略 asc 请求", "name,concurrency", "asc", []sortLevel{
			{column: "name", asc: true}, {column: "concurrency", asc: false},
		}},
		{"超过上限被截断", "name,concurrency,id", "desc", []sortLevel{
			{column: "name", asc: true}, {column: "concurrency", asc: false},
		}},
		{"重复维度去重", "name,name", "asc", []sortLevel{{column: "name", asc: true}}},
		{"非法维度被丢弃", "name,drop_table", "asc", []sortLevel{{column: "name", asc: true}}},
		{"忽略空白与大小写", " Name , Concurrency ", "desc", []sortLevel{
			{column: "name", asc: true}, {column: "concurrency", asc: false},
		}},
		{"空段被跳过", "name,,concurrency", "desc", []sortLevel{
			{column: "name", asc: true}, {column: "concurrency", asc: false},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			options := NewTokenSortOptions(tc.sortBy, tc.order)
			assert.Equal(t, tc.want, options.sortLevels())
		})
	}
}

func TestTokenSortHasConcurrency(t *testing.T) {
	assert.True(t, NewTokenSortOptions("concurrency", "desc").HasConcurrency())
	assert.True(t, NewTokenSortOptions("name,concurrency", "desc").HasConcurrency())
	// 第三级被截断后不应再算命中
	assert.False(t, NewTokenSortOptions("name,id,concurrency", "desc").HasConcurrency())
	assert.False(t, NewTokenSortOptions("name", "desc").HasConcurrency())
	// 没有给出可用链时回落到默认链，默认链含并发维度
	assert.True(t, NewTokenSortOptions("", "desc").HasConcurrency())
}

// TestSortTokensInMemoryMultiLevel 锁定多级排序的比较语义：
// 先按第一级比，相等才看第二级，且每一级用它自己的方向。
func TestSortTokensInMemoryMultiLevel(t *testing.T) {
	tokens := []*Token{
		{Id: 1, Name: "bravo", Status: 1},
		{Id: 2, Name: "alpha", Status: 1},
		{Id: 3, Name: "charlie", Status: 1},
		{Id: 4, Name: "delta", Status: 1},
	}

	// 第一级 status 升序（1=启用 排前面），status 相同的按第二级 name 升序。
	// 这正是「各级用自己的方向」的关键：共用一个全局方向时 name 会被排成 Z→A。
	options := NewTokenSortOptions("status,name", "desc")
	sorted := SortTokensInMemory(tokens, options, 0, -1)

	require.Len(t, sorted, 4)
	got := make([]int, len(sorted))
	for i, token := range sorted {
		got[i] = token.Id
	}
	assert.Equal(t, []int{2, 1, 3, 4}, got)
}

// TestSortTokensInMemoryGroupOrdering 锁定分组维度的比较语义：
// 分组名按字典序升序，未分组永远排在最后（升序降序都如此）。
func TestSortTokensInMemoryGroupOrdering(t *testing.T) {
	tokens := []*Token{
		{Id: 1, Name: "a", TokenGroup: ""},
		{Id: 2, Name: "b", TokenGroup: "mac"},
		{Id: 3, Name: "c", TokenGroup: "game"},
		{Id: 4, Name: "d", TokenGroup: "mac"},
	}

	sorted := SortTokensInMemory(tokens, NewTokenSortOptions("group", "asc"), 0, -1)
	require.Len(t, sorted, 4)
	got := make([]int, len(sorted))
	for i, token := range sorted {
		got[i] = token.Id
	}
	// game → mac → mac → 未分组
	assert.Equal(t, []int{3, 2, 4, 1}, got)

	// 分组维度降序时，未分组依然排在最后；同名分组保持原有相对顺序（稳定排序）
	sorted = SortTokensInMemory(tokens, NewTokenSortOptions("group", "desc"), 0, -1)
	require.Len(t, sorted, 4)
	got = make([]int, len(sorted))
	for i, token := range sorted {
		got[i] = token.Id
	}
	assert.Equal(t, []int{2, 4, 3, 1}, got)
}

// TestSortTokensInMemoryPagination 锁定内存排序后的分页切片语义：
// 排序必须发生在分页之前，跨页结果才是对的。
func TestSortTokensInMemoryPagination(t *testing.T) {
	tokens := []*Token{
		{Id: 1, Name: "a"},
		{Id: 2, Name: "b"},
		{Id: 3, Name: "c"},
		{Id: 4, Name: "d"},
	}
	options := NewTokenSortOptions("name", "asc")

	page1 := SortTokensInMemory(tokens, options, 0, 2)
	require.Len(t, page1, 2)
	assert.Equal(t, 1, page1[0].Id)
	assert.Equal(t, 2, page1[1].Id)

	page2 := SortTokensInMemory(tokens, options, 2, 2)
	require.Len(t, page2, 2)
	assert.Equal(t, 3, page2[0].Id)
	assert.Equal(t, 4, page2[1].Id)

	// 起点越界返回空切片，不 panic
	assert.Empty(t, SortTokensInMemory(tokens, options, 10, 2))
}

// TestNormalizeTokenGroupName 锁定分组名校验规则：空串合法（未分组），
// 超长与控制字符被拒绝。
func TestNormalizeTokenGroupName(t *testing.T) {
	name, err := NormalizeTokenGroupName("  mac  ")
	require.NoError(t, err)
	assert.Equal(t, "mac", name)

	name, err = NormalizeTokenGroupName("   ")
	require.NoError(t, err)
	assert.Equal(t, "", name)

	_, err = NormalizeTokenGroupName("abc\ndef")
	assert.ErrorIs(t, err, ErrTokenGroupNameInvalid)

	tooLong := ""
	for range TokenGroupNameMaxLength + 1 {
		tooLong += "a"
	}
	_, err = NormalizeTokenGroupName(tooLong)
	assert.ErrorIs(t, err, ErrTokenGroupNameTooLong)
}
