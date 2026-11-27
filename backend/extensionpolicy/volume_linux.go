package extensionpolicy

import "golang.org/x/sys/unix"

func safeFilesystem(fd int) bool {
	var fs unix.Statfs_t
	if unix.Fstatfs(fd, &fs) != nil {
		return false
	}
	// inotify registration can succeed on a network/FUSE mount without
	// delivering remote writes. Accept only known local, notifying filesystems.
	const zfsMagic = 0x2fc12fc1
	switch kernelID32(fs.Type) {
	case unix.EXT4_SUPER_MAGIC, unix.XFS_SUPER_MAGIC, unix.BTRFS_SUPER_MAGIC, unix.F2FS_SUPER_MAGIC,
		unix.TMPFS_MAGIC, unix.RAMFS_MAGIC, unix.OVERLAYFS_SUPER_MAGIC, zfsMagic:
		return true
	}
	return false
}

func exchangeAt(fd int, a, b string) error {
	return unix.Renameat2(fd, a, fd, b, unix.RENAME_EXCHANGE)
}
