package appstate

import "testing"

// The cached lookups are what every profile and data operation of a running
// plugin goes through. They must stay a map lookup under one mutex: no system
// call, no allocation. Run with
//
//	go test ./internal/appstate -run '^$' -bench PluginRoots -benchmem

func BenchmarkPluginRootsStoreCached(b *testing.B) {
	svc := NewTestService(b)
	if _, err := svc.PluginStore("bench-plugin"); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if _, err := svc.PluginStore("bench-plugin"); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkPluginRootsStoreCachedParallel(b *testing.B) {
	svc := NewTestService(b)
	if _, err := svc.PluginStore("bench-plugin"); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			if _, err := svc.PluginStore("bench-plugin"); err != nil {
				b.Error(err)
				return
			}
		}
	})
}

func BenchmarkPluginRootsDataIfExistsCached(b *testing.B) {
	svc := NewTestService(b)
	if _, err := svc.PluginData("bench-plugin"); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if _, ok, err := svc.PluginDataIfExists("bench-plugin"); err != nil || !ok {
			b.Fatal(err, ok)
		}
	}
}
