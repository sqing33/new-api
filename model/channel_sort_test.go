package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 渠道列表支持多级排序：SortBy 是逗号分隔的排序链，Apply 按顺序追加 ORDER BY。
// 这里锁定链的解析规则——顺序保持、去重、长度受限、非法维度被丢弃。

func TestChannelSortLevelsParsing(t *testing.T) {
	cases := []struct {
		name   string
		sortBy string
		order  string
		want   []sortLevel
	}{
		{"空串不产生排序链", "", "desc", nil},
		// 单级排序尊重显式方向
		{"单级 name 升序", "name", "asc", []sortLevel{{column: "name", asc: true}}},
		{"单级 name 降序", "name", "desc", []sortLevel{{column: "name", asc: false}}},
		{"单级 concurrency 降序", "concurrency", "desc", []sortLevel{{column: "concurrency", asc: false}}},
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
		{"全部非法则为空链", "drop_table", "desc", nil},
		{"忽略空白与大小写", " Name , Concurrency ", "desc", []sortLevel{
			{column: "name", asc: true}, {column: "concurrency", asc: false},
		}},
		{"空段被跳过", "name,,concurrency", "desc", []sortLevel{
			{column: "name", asc: true}, {column: "concurrency", asc: false},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			options := NewChannelSortOptions(tc.sortBy, tc.order, false)
			if len(tc.want) == 0 {
				// nil 与空切片语义等价（都表示「无排序链」）
				assert.Empty(t, options.sortLevels())
				return
			}
			assert.Equal(t, tc.want, options.sortLevels())
		})
	}
}

func TestChannelSortHasConcurrency(t *testing.T) {
	assert.True(t, NewChannelSortOptions("concurrency", "desc", false).HasConcurrency())
	assert.True(t, NewChannelSortOptions("name,concurrency", "desc", false).HasConcurrency())
	// 第三级被截断后不应再算命中
	assert.False(t, NewChannelSortOptions("name,id,concurrency", "desc", false).HasConcurrency())
	assert.False(t, NewChannelSortOptions("name", "desc", false).HasConcurrency())
	assert.False(t, NewChannelSortOptions("", "desc", false).HasConcurrency())
}

// TestSortChannelsInMemoryMultiLevel 锁定多级排序的比较语义：
// 先按第一级比，相等才看第二级。并发维度不在数据库里，由内存排序处理，
// 这里用 counts 为 nil 的路径验证纯数据库维度的多级比较。
func TestSortChannelsInMemoryMultiLevel(t *testing.T) {
	priority := func(v int64) *int64 { return &v }
	channels := []*Channel{
		{Id: 1, Name: "bravo", Priority: priority(2)},
		{Id: 2, Name: "alpha", Priority: priority(2)},
		{Id: 3, Name: "charlie", Priority: priority(5)},
		{Id: 4, Name: "delta", Priority: priority(1)},
	}

	// 第一级 priority 降序，priority 相同的按第二级 name 升序（A→Z，
	// name 的自然方向）。这正是「各级用自己的方向」的关键：共用一个
	// 全局方向时 name 会被排成 Z→A。
	// 期望 3(p5) → 2(alpha,p2) → 1(bravo,p2) → 4(p1)
	options := NewChannelSortOptions("priority,name", "desc", false)
	sorted := SortChannelsInMemory(channels, options, 0, -1)

	require.Len(t, sorted, 4)
	got := make([]int, len(sorted))
	for i, channel := range sorted {
		got[i] = channel.Id
	}
	assert.Equal(t, []int{3, 2, 1, 4}, got)
}

// TestSortChannelsInMemoryPerLevelDirection 锁定「各级方向独立」：
// 同一个 sort_order 请求下，name 走升序、concurrency 走降序，
// 而不是整条链共用一个方向。
func TestSortChannelsInMemoryPerLevelDirection(t *testing.T) {
	priority := func(v int64) *int64 { return &v }
	channels := []*Channel{
		{Id: 1, Name: "alpha", Priority: priority(1)},
		{Id: 2, Name: "bravo", Priority: priority(1)},
		{Id: 3, Name: "charlie", Priority: priority(9)},
	}

	// 请求显式传 desc，但 name 仍应升序——多级排序忽略全局方向
	options := NewChannelSortOptions("name,priority", "desc", false)
	sorted := SortChannelsInMemory(channels, options, 0, -1)
	require.Len(t, sorted, 3)
	assert.Equal(t, []string{"alpha", "bravo", "charlie"},
		[]string{sorted[0].Name, sorted[1].Name, sorted[2].Name},
		"name 的自然方向是升序，不受 sort_order=desc 影响")
}

// TestSortChannelsInMemoryPagination 锁定内存排序后的分页切片语义：
// 并发排序必须能跨页正确，所以分页发生在排序之后。
func TestSortChannelsInMemoryPagination(t *testing.T) {
	priority := func(v int64) *int64 { return &v }
	channels := []*Channel{
		{Id: 1, Name: "a", Priority: priority(4)},
		{Id: 2, Name: "b", Priority: priority(3)},
		{Id: 3, Name: "c", Priority: priority(2)},
		{Id: 4, Name: "d", Priority: priority(1)},
	}
	options := NewChannelSortOptions("priority", "desc", false)

	page1 := SortChannelsInMemory(channels, options, 0, 2)
	require.Len(t, page1, 2)
	assert.Equal(t, 1, page1[0].Id)
	assert.Equal(t, 2, page1[1].Id)

	page2 := SortChannelsInMemory(channels, options, 2, 2)
	require.Len(t, page2, 2)
	assert.Equal(t, 3, page2[0].Id)
	assert.Equal(t, 4, page2[1].Id)

	// 起点越界返回空切片，不 panic
	assert.Empty(t, SortChannelsInMemory(channels, options, 10, 2))
}

// TestSortChannelsInMemoryNilPriority 锁定 Priority 为 nil 时的行为：
// 数据库列是 *int64，nil 必须按 0 处理而不是 panic。
func TestSortChannelsInMemoryNilPriority(t *testing.T) {
	priority := func(v int64) *int64 { return &v }
	channels := []*Channel{
		{Id: 1, Name: "has-priority", Priority: priority(5)},
		{Id: 2, Name: "nil-priority", Priority: nil},
	}
	sorted := SortChannelsInMemory(channels, NewChannelSortOptions("priority", "desc", false), 0, -1)
	require.Len(t, sorted, 2)
	assert.Equal(t, 1, sorted[0].Id, "priority=5 应排在 nil(=0) 之前")
	assert.Equal(t, 2, sorted[1].Id)
}
