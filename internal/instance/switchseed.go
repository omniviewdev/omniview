package instance

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

const SwitchSeedFile = "switch-seed.json"
const switchSeedSchema = "omniview-switch-seed/v1"

type switchSeed struct {
	Schema    string    `json:"schema"`
	Source    string    `json:"source"`
	CreatedAt time.Time `json:"createdAt"`
}

func WriteSwitchSeed(targetRoot, sourceRoot string) error {
	if err := os.MkdirAll(targetRoot, 0700); err != nil {
		return fmt.Errorf("create switch target: %w", err)
	}
	data, err := json.Marshal(switchSeed{Schema: switchSeedSchema, Source: sourceRoot, CreatedAt: time.Now().UTC()})
	if err != nil {
		return fmt.Errorf("encode switch seed: %w", err)
	}
	f, err := os.CreateTemp(targetRoot, ".switch-seed-*")
	if err != nil {
		return fmt.Errorf("create switch seed: %w", err)
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		f.Close()
		return fmt.Errorf("write switch seed: %w", err)
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return fmt.Errorf("sync switch seed: %w", err)
	}
	if err = f.Close(); err != nil {
		return fmt.Errorf("close switch seed: %w", err)
	}
	if err = os.Rename(f.Name(), filepath.Join(targetRoot, SwitchSeedFile)); err != nil {
		return fmt.Errorf("publish switch seed: %w", err)
	}
	return nil
}

func ApplySwitchSeed(stateRoot string) error {
	path := filepath.Join(stateRoot, SwitchSeedFile)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read switch seed: %w", err)
	}
	var seed switchSeed
	if err := json.Unmarshal(data, &seed); err != nil {
		return fmt.Errorf("decode switch seed: %w", err)
	}
	if seed.Schema != switchSeedSchema || !filepath.IsAbs(seed.Source) {
		return fmt.Errorf("invalid switch seed source or schema")
	}
	info, err := os.Stat(seed.Source)
	if err != nil {
		return fmt.Errorf("stat switch seed source: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("switch seed source is not a directory")
	}
	overlap, err := devcontract.ProfilePathsOverlap(seed.Source, stateRoot)
	if err != nil {
		return fmt.Errorf("check switch seed overlap: %w", err)
	}
	if overlap {
		return fmt.Errorf("switch seed source overlaps target")
	}
	staging := filepath.Join(stateRoot, ".switch-seed-staging")
	if err := os.RemoveAll(staging); err != nil {
		return fmt.Errorf("remove stale switch staging: %w", err)
	}
	if err := os.Mkdir(staging, 0700); err != nil {
		return fmt.Errorf("create switch staging: %w", err)
	}
	entries, err := os.ReadDir(seed.Source)
	if err != nil {
		return fmt.Errorf("read switch source: %w", err)
	}
	for _, entry := range entries {
		switch entry.Name() {
		case "runtime", SwitchSeedFile, "update-checkpoints.json", "update-checkpoints.lock":
			continue
		}
		if err := copySwitchEntry(filepath.Join(seed.Source, entry.Name()), filepath.Join(staging, entry.Name())); err != nil {
			return fmt.Errorf("copy switch entry %q: %w", entry.Name(), err)
		}
	}
	entries, err = os.ReadDir(staging)
	if err != nil {
		return fmt.Errorf("read switch staging: %w", err)
	}
	for _, entry := range entries {
		if err := os.Rename(filepath.Join(staging, entry.Name()), filepath.Join(stateRoot, entry.Name())); err != nil {
			return fmt.Errorf("install switch entry %q: %w", entry.Name(), err)
		}
	}
	if err := os.Remove(staging); err != nil {
		return fmt.Errorf("remove switch staging: %w", err)
	}
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("remove switch seed: %w", err)
	}
	return nil
}

func copySwitchEntry(src, dst string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	switch {
	case info.Mode().IsRegular():
		in, err := os.Open(src)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(out, in)
		closeErr := out.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		return os.Chmod(dst, info.Mode()&(os.ModePerm|os.ModeSetuid|os.ModeSetgid|os.ModeSticky))
	case info.IsDir():
		if err := os.Mkdir(dst, 0700); err != nil {
			return err
		}
		entries, err := os.ReadDir(src)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := copySwitchEntry(filepath.Join(src, entry.Name()), filepath.Join(dst, entry.Name())); err != nil {
				return err
			}
		}
		return os.Chmod(dst, info.Mode()&(os.ModePerm|os.ModeSetuid|os.ModeSetgid|os.ModeSticky))
	case info.Mode()&os.ModeSymlink != 0:
		target, err := os.Readlink(src)
		if err != nil {
			return err
		}
		return os.Symlink(target, dst)
	default:
		return nil
	}
}
