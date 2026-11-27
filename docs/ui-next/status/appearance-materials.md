# Appearance materials

Worktree: `../worktrees/appearance-materials`. Branch: `appearance-materials`, based on `origin/main` at `af58b162f`.

2026-11-27: Two source audits and two independent design reviews completed. The owner approved private WK transparency for next-native macOS 26+ and requested labels and values only: no status row or explanatory text. Goal: Appearance settings for window material, glass style and four surface fills, with a reusable accessible Slider. Native context menus remain outside scope.

Review gates: one settings transaction per gesture, no native effects on opacity changes, no changes to the stable UI, composed native proof and a measured comparison before PR.
