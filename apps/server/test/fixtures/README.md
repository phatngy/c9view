# Synthetic Claude data

`claude/` contains two projects and three parent sessions. Session `s1` has a completed subagent and a pending AskUserQuestion call; `s2` has a completed tool result and an unknown model; `s3` is the busy-session fixture. Long tool inputs/results exercise the 20,000-character cap. All credentials are deliberately fake.

Tests copy this tree to a temporary directory, replace cwd placeholders, and create live-status JSON files with the test process PID. No fixture depends on an existing Claude installation or running Claude process. Tests remove the temporary copy afterward.
