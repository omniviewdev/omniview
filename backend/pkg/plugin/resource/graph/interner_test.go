package graph

import "testing"

func TestInterner_InternReturnsSamePointer(t *testing.T) {
	si := newStringInterner()
	a := si.Intern("hello")
	b := si.Intern("hello")
	if a != b {
		t.Fatal("expected same string pointer for same input")
	}
}

func TestInterner_RefCounting(t *testing.T) {
	si := newStringInterner()
	si.Intern("hello")
	si.Intern("hello")
	si.Intern("hello")

	if si.refCount("hello") != 3 {
		t.Fatalf("expected refcount 3, got %d", si.refCount("hello"))
	}

	si.Release("hello")
	if si.refCount("hello") != 2 {
		t.Fatalf("expected refcount 2, got %d", si.refCount("hello"))
	}

	si.Release("hello")
	si.Release("hello")
	if si.refCount("hello") != 0 {
		t.Fatal("expected refcount 0 after full release")
	}
	if si.Len() != 0 {
		t.Fatal("expected interner to be empty after all releases")
	}
}

func TestInterner_DifferentStrings(t *testing.T) {
	si := newStringInterner()
	a := si.Intern("foo")
	b := si.Intern("bar")
	if a == b {
		t.Fatal("different strings should have different pointers")
	}
	if si.Len() != 2 {
		t.Fatalf("expected 2 entries, got %d", si.Len())
	}
}

func TestInterner_ReleaseNonExistent(t *testing.T) {
	si := newStringInterner()
	si.Release("nonexistent") // Should not panic
}
