# Status: PTYCR (the flood tests and the extra CR of the terminal of macOS)

- Agent: TerminalChannel. Ask (lead, 2026-11-24, after #704 merged as `169da34c`): settle whether the failures of `TestAReloadUnderAFloodReattachesByteExactByOffset` that the lead saw on the merged tree are a defect of #704 or an artefact of macOS; if an artefact, fix the test at its cause in a separate small PR on main, and record the artefact.
- Worktree: `~/Repos/omniviewdev/worktrees/fix-flood-test-cr`. Branch: `test/pty-cr-artifact`, on `origin/main` `169da34c`.
- Owned and changed: `backend/pkg/terminal/manager.go` (`Manager.tee`: a seam of the tests, nil in the host, three lines in the read loop), `pty_cr_test.go` (new), `reattach_flood_test.go`, `flow_test.go`, `docs/ui-next/terminal/backend-catalog-terminal.md` (section 4), this file and `PTYCR/mutate.py.txt`.

## 1. The answer

**An artefact of the terminal of macOS, the same on both trees; no defect of #704.** The extra CR is in the bytes the kernel hands the host before any code of the host reads them (13 of 13 failing runs), a program with no code of the host in it reproduces it, and the failure rate of the flood test is the same with and without #704 (12 and 13 of 100). The tests were wrong to hold a flood to the text the program printed; they now hold the host to the bytes the kernel gave it.

## 2. The counts (macOS 27.0.1, Darwin 27.0.0 arm64; the host was never idle: other work kept the one-minute load average between 4.7 and 10.5 in the batches below, up to 58 in the last one, and it is logged before every run)

| Run | main `30df52ea` | main + #704 (`89194a9e`) |
|---|---|---|
| the flood test alone, 100 runs of each, alternating, one at a time | **12 failed of 100** | **13 failed of 100** |
| by the load before the run: below 5 / 5 to 7 / 7 to 9 / 9 and over | 0 of 12 / 3 of 50 / 2 of 14 / 7 of 24 | 2 of 12 / 4 of 49 / 2 of 17 / 5 of 22 |
| the same test with the tee and the reload offsets compiled in, alternating until six failures each | 7 failed of 30 | 6 failed of 30 |

The whole terminal package, 30 runs of each, was NOT run: the lead stopped it after the first run. That run on main, the only one that completed, failed in the same test with the same signature (first difference at byte 15,573,590, one byte too many). A first batch of the single-test runs was discarded because two drivers of the script overlapped for a few minutes (it had 1 of 20 on main and 2 of 19 on the merged tree).

## 3. Every failure, classified

All 25 failures of the 200 runs of the first table row have one signature: the first difference between what the page rendered and the expected text is a CR directly before a CR LF (`1980109\r\r\n1980110`), and the run has 1 to 11 bytes more than the text, 1 byte in 13 of the 25, 2 in 5, 3 in 3, one run each with 4, 5, 6 and 11. They are anywhere in the stream (the first difference from byte 1,426 to byte 16,813,826), not at a particular place. The first assertion of the test to fail is the comparison of the page with the text ("what the page rendered across its reloads"); the length of the end (`16888897` where `16888896` was wanted) fails with it.

## 4. The source

**The tee.** `Manager.tee`, when a test sets it, is given the bytes of every read of a pty master, and where each read ended, before the host clones, counts, rings or delivers them (the first host code after the read system call). The instrumented binaries of both trees ran the flood test alternately until each had six failures (`TestAReloadUnder...` plus a log of the offset each reload took the page to). In **13 of 13 failing runs** (7 and 6) the tee has the `CR CR LF`: 22 of them (15 and 7).

- With each of them taken back to `CR LF` the tee is exactly the text awk printed: 13 of 13. Nothing else differs, in any run.
- **22 of 22** are the last byte of a read of exactly 1,024 bytes, and the next read begins with `CR LF` (the tty's output queue was full between the CR and the LF of the translation of one line end; BSD's `ttyoutput` hands back a character it could not finish and writes it again, CR included [INFERENCE for the kernel; the observation is measured]).
- **0 of 22** are within 2 bytes of an offset where a reloaded page was handed its replay (2 of the 22 lie inside some replay range, by chance: replays cover a tenth of the stream or so); the ring and the replay are not involved.
- The host's own stream equals the tee byte for byte in every run, including the failing ones: the host delivers what the kernel gave it.

**Without the host.** A small program (not committed) opens a pty with `creack/pty`, runs `awk 'BEGIN { for (i = 1; i <= 2000000; i++) print i }'` on it (awk writes only LF) and does nothing but read the master. 20 runs of each pacing of the reader: 64 KiB reads as fast as it can, **1 run with a CR CR LF** (2 in all); a 10 ms pause after every 256 KiB, **6 runs** (88 in all); 256-byte reads, **2 runs** (8 in all); a 1 ms pause after every MiB, 0. With every CR CR LF taken back to CR LF the stream was exactly the printed text in all 80 runs. The artefact is in the kernel's tty and needs no code of Omniview.

## 5. The change

1. **The seam** (`manager.go`): `Manager.tee func(id string, data []byte)`, nil in the host; the read loop calls it when it is set, right after the read and before `slices.Clone`. A nil check per read is its whole cost in the host.
2. **The oracle** (`pty_cr_test.go`): `ptyTee` records the bytes and the end of every read; `withoutTheCRsOfMacOS` takes out a CR that ends a read and is followed by CR LF (a run of them too) and nothing else: the program's own CR LF split between its CR and its LF by a read stays, a CR that does not end a read stays, a line end that lost its CR stays, a lost byte stays.
3. **`TestAReloadUnderAFloodReattachesByteExactByOffset`** now holds the page and the host's events to the tee byte for byte, the end offset to the tee's length, and the tee less those CRs to the text awk printed. **`TestTenMebibytesOfOutputArriveCompleteAndInOrderWhoeverGivesTheCredit`**, the other test that holds a flood to its text, the same, in each of its three modes.
4. The artefact is recorded in `docs/ui-next/terminal/backend-catalog-terminal.md`, section 4 (what it is, the measurements, who sees it, what the host and the tests do).

## 6. The sweep of `backend/pkg/terminal/*_test.go`

| Test | Class | Done |
|---|---|---|
| `TestAReloadUnderAFloodReattachesByteExactByOffset` | holds a 17 MB flood to its text: the one that failed | fixed |
| `TestTenMebibytesOfOutputArriveCompleteAndInOrderWhoeverGivesTheCredit` (flow) | holds a 10 MiB flood, three times, to its text and its SHA-256: same exposure by construction; **not seen failing** in these runs | fixed the same way |
| `TestTwentyReloadsUnderYes...`, `TestAnAttachUnderAFlood...` and the other tests that flood with `yes` | compare the page with the host's own events | none needed (they already did what this change does; the comment of the first says why) |
| `manager_test.go` (`Contains(..., "line-399\r\ntail-end\r\n")`) | 400 lines of about 4 KB; the extra CR would have to land on one of two particular line ends | listed, not changed: negligible exposure |
| the tests that wait for a few short lines (`one\r\ntwo\r\n`, `A\r\n`, ...) | the queue never fills | none needed |
| `TestAFailedPtyIsTypedAndTheShellIsEnded` | **not this class**: it fails `expected "failed", actual "signaled"`; 7 of 1,000 on main and 13 of 1,000 on #704's branch in the CI image under CPU load (alone, 60 of 60 pass on both): the test closes the master under a live shell, and the shell's SIGHUP and the read error race for what the end says [INFERENCE] | listed, not changed here |
| `TestTwoHundredDetachedTerminalsHoldABoundedState...` | **not this class**: "never wrote enough to fill its ring" under load | listed, not changed here |

## 7. Verification

| Claim | Result |
|---|---|
| Tests first | the red commit has the seam field and the recorder with the seam not called and the helper inert: `TestTheTeeHolds...` and three cases of `TestTheCRsOfTheTerminalOfMacOS...` fail by assertion (the tee empty; `1\r\n2\r\r\n3\r\n` not turned into the text); the green commit turns all of them green. The flood test itself fails at random, so its proof is the comparison below |
| The same load, old test against new | `go test -c` of the terminal package at `169da34c` and at this branch, 100 runs of the flood test of each, alternating, one at a time: **the old test failed 14 of 100, the new test 0 of 100**; by the load before the run (below 5 / 5 to 7 / 7 to 9 / 9 to 15 / 15 and over): old 1 of 26, 2 of 28, 0 of 11, 6 of 18, 5 of 17; new 0 of 25, 0 of 28, 0 of 15, 0 of 15, 0 of 17 (load up to 58) |
| A real defect still fails the changed test | `PTYCR/mutate.py.txt`, each fault in a scratch copy (`go test -overlay`): **M1** a byte repeated at the join of the replay and the live output, **M2** a byte dropped at the join: red by the existing wait for the page to have as many bytes as the shell wrote, and still red with the byte-for-byte comparisons taken out. **M3** a byte repeated in place of the next at the join (the replay keeps its length): red by the new comparison of the page with the tee (`streams differ at byte 1048638`), and passes with that comparison taken out. **M4** the host loses a byte before delivering it: red by the end offset against the tee's length. **C5** a helper that takes out every CR CR LF: red by the case "a CR before CR LF that is not at the end of a read". `controls not as named: 0` |
| Lint, CI form (`golangci-lint` v2.15.0, `origin/main...HEAD`), default and `--build-tags server` | 0 issues in both |
| `go vet` of the package, default, `GOOS=windows`, `GOOS=linux` | clean |
| `-race` on macOS | the tee test and the table of the helper, `-count=3`: ok; the two flood tests, `-count=1`: ok (9.1 s and 8.2 s) |
| `node scripts/ci/changes.test.mjs` (the Repo guard) | 48 of 48 |

## 8. Not verified, and limits

- The whole terminal package, 30 runs of each tree: not run (stopped by the lead).
- Another macOS version, Linux (the flood tests have passed there in CI and in containers; nobody looked for the artefact there), a program other than awk, the Windows build (the seam is in the unix manager only).
- `TestTenMebibytes...` was not seen failing: its fix rests on its being the same construction, and on the host-free reproduction's fast reader (1 of 20 runs of a 17 MB flood), which is the reader it has.
- The rates are of a host that was never idle (load 4.7 to 58 in the runs above); the comparison of old and new is of alternating runs, so the load was the same for both, but it is not the rate of a quiet machine.
- The raw numbers of the batches are in the scratch of the run, not in the repository.
