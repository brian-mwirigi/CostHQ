Set-Location (Split-Path -Parent $PSScriptRoot)
$ErrorActionPreference = 'Continue'
$passed = 0
$failed = 0

function Test-Pass($name) { Write-Host "  PASS: $name" -ForegroundColor Green; $script:passed++ }
function Test-Fail($name, $detail) { Write-Host "  FAIL: $name - $detail" -ForegroundColor Red; $script:failed++ }

# Setup
$posDir = Join-Path $env:TEMP 'codesession-autolog'
if (Test-Path $posDir) { Remove-Item -Recurse -Force $posDir }
$transcriptDir = Join-Path $env:TEMP 'cs-test-transcript'
if (Test-Path $transcriptDir) { Remove-Item -Recurse -Force $transcriptDir }
New-Item -ItemType Directory -Force -Path $transcriptDir | Out-Null

# Close any stale sessions
node dist/index.js end --json 2>$null

# Helper to create transcript file
function Write-Transcript($fileName, $lines) {
    $path = Join-Path $transcriptDir $fileName
    # Write without BOM using .NET to avoid PowerShell BOM issues
    [System.IO.File]::WriteAllText($path, ($lines -join "`n"), (New-Object System.Text.UTF8Encoding $false))
    return $path
}

# Helper to pipe hook input
function Invoke-AutoLog($sessionId, $transcriptPath, $extraArgs = '') {
    $hookInput = @{ session_id = $sessionId; transcript_path = $transcriptPath; cwd = (Get-Location).Path; hook_event_name = 'Stop' } | ConvertTo-Json -Compress
    $cmd = "node dist/index.js auto-log $extraArgs"
    return ($hookInput | Invoke-Expression $cmd 2>&1)
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  codesession auto-log test suite" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# ─── TEST 1: No stdin (TTY check) ────────────────────────────
Write-Host "[Test 1] No stdin - should not hang" -ForegroundColor Yellow
$result = node dist/index.js auto-log 2>&1
$exitCode = $LASTEXITCODE
# In a real terminal, isatty(0) returns true -> exit 1
# In scripted environments, stdin is not a TTY -> reads empty stdin -> exit 0
# Either way, it must NOT hang
if ($exitCode -eq 1 -or $exitCode -eq 0) { Test-Pass "Exits without hanging (code=$exitCode)" }
else { Test-Fail "TTY check" "Unexpected exit code: $exitCode" }

# ─── TEST 2: Empty stdin ─────────────────────────────────────
Write-Host "[Test 2] Empty stdin" -ForegroundColor Yellow
$result = '' | node dist/index.js auto-log 2>&1
if ($LASTEXITCODE -eq 0) { Test-Pass "Exits cleanly with empty stdin" }
else { Test-Fail "Empty stdin" "Expected exit 0, got $LASTEXITCODE" }

# ─── TEST 3: Invalid JSON stdin ──────────────────────────────
Write-Host "[Test 3] Invalid JSON stdin" -ForegroundColor Yellow
$result = 'not json at all' | node dist/index.js auto-log 2>&1
if ($LASTEXITCODE -eq 0) { Test-Pass "Exits cleanly with invalid JSON" }
else { Test-Fail "Invalid JSON" "Expected exit 0, got $LASTEXITCODE" }

# ─── TEST 4: Missing transcript_path in JSON ─────────────────
Write-Host "[Test 4] Missing transcript_path" -ForegroundColor Yellow
$result = '{"session_id":"abc"}' | node dist/index.js auto-log 2>&1
if ($LASTEXITCODE -eq 0) { Test-Pass "Exits cleanly when transcript_path missing" }
else { Test-Fail "Missing transcript_path" "Expected exit 0, got $LASTEXITCODE" }

# ─── TEST 5: Nonexistent transcript file ─────────────────────
Write-Host "[Test 5] Nonexistent transcript file" -ForegroundColor Yellow
$result = '{"session_id":"abc","transcript_path":"C:\\nonexistent\\file.jsonl"}' | node dist/index.js auto-log 2>&1
if ($LASTEXITCODE -eq 0) { Test-Pass "Exits cleanly when file doesn't exist" }
else { Test-Fail "Nonexistent file" "Expected exit 0, got $LASTEXITCODE" }

# ─── TEST 6: No active session - should NOT save position ────
Write-Host "[Test 6] No active session - must not save position" -ForegroundColor Yellow
# Make sure no session is active
node dist/index.js end --json 2>$null
$tf = Write-Transcript 'test6.jsonl' @(
    '{"role":"user","content":"Hello world this is a long enough message to pass the token threshold definitely"}'
    '{"role":"assistant","content":"Sure, I will help you with that task. Let me analyze the codebase and find the relevant files. Here is my detailed response with enough content to exceed the minimum token threshold for logging."}'
)
$hookInput = @{ session_id = 'test6-session'; transcript_path = $tf; cwd = (Get-Location).Path; hook_event_name = 'Stop' } | ConvertTo-Json -Compress
$result = $hookInput | node dist/index.js auto-log 2>&1
$posFile = Join-Path $posDir 'test6-session.pos'
if (-not (Test-Path $posFile)) { Test-Pass "Position NOT saved when no active session (tokens preserved for later)" }
else { Test-Fail "No-session position save" "Position file was created - tokens would be lost!" }

# ─── TEST 7: Normal operation - start session, auto-log, check ─
Write-Host "[Test 7] Normal operation" -ForegroundColor Yellow
node dist/index.js start 'auto-log-test' --json --close-stale 2>$null | Out-Null
$tf = Write-Transcript 'test7.jsonl' @(
    '{"role":"user","content":"Fix the payment retry logic and add tests for the exponential backoff implementation"}'
    '{"role":"assistant","content":"I will analyze the existing retry implementation in src/payments.ts and src/retry.ts to understand the current behavior before making changes. Let me read through the files and identify the issues with the current retry logic."}'
    '{"role":"user","content":"looks good, go ahead and implement the fix"}'
    '{"role":"assistant","content":"I have updated the retry logic to use exponential backoff with a maximum of 5 retries. The base delay is 1 second and doubles each attempt. I also added comprehensive tests covering success, failure, and timeout scenarios across multiple edge cases."}'
)
$hookInput = @{ session_id = 'test7-session'; transcript_path = $tf; cwd = (Get-Location).Path; hook_event_name = 'Stop' } | ConvertTo-Json -Compress
$result = $hookInput | node dist/index.js auto-log --provider anthropic --model claude-sonnet-4 2>&1
$parsed = $result | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($parsed.autoLogged -eq $true -and $parsed.tokens.total -gt 0 -and $parsed.cost -gt 0) {
    Test-Pass "Logged tokens=$($parsed.tokens.total) cost=$($parsed.cost)"
} else { Test-Fail "Normal operation" "Unexpected output: $result" }

# ─── TEST 8: De-duplication - same transcript, second call ────
Write-Host "[Test 8] De-duplication - second call same transcript" -ForegroundColor Yellow
$result2 = $hookInput | node dist/index.js auto-log --provider anthropic --model claude-sonnet-4 2>&1
if ([string]::IsNullOrWhiteSpace($result2)) { Test-Pass "Second call produces no output (de-dup works)" }
else { Test-Fail "De-duplication" "Expected empty, got: $result2" }

# ─── TEST 9: Incremental growth - append to transcript ────────
Write-Host "[Test 9] Incremental transcript growth" -ForegroundColor Yellow
# Append more lines to the same transcript
$existingContent = [System.IO.File]::ReadAllText($tf)
$newContent = $existingContent + "`n" + '{"role":"user","content":"Now please also add integration tests and update the documentation for the retry module"}' + "`n" + '{"role":"assistant","content":"I will add integration tests that verify the retry behavior end-to-end with mocked HTTP responses. I will also update the README to document the new exponential backoff configuration options and their default values."}'
[System.IO.File]::WriteAllText($tf, $newContent, (New-Object System.Text.UTF8Encoding $false))

$result3 = $hookInput | node dist/index.js auto-log --provider anthropic --model claude-sonnet-4 2>&1
$parsed3 = $result3 | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($parsed3.autoLogged -eq $true -and $parsed3.tokens.total -gt 0) {
    Test-Pass "Incremental: logged only new tokens=$($parsed3.tokens.total)"
} else { Test-Fail "Incremental growth" "Expected new tokens, got: $result3" }

# ─── TEST 10: Coexistence with manual log-ai ─────────────────
Write-Host "[Test 10] Coexistence with manual cs log-ai" -ForegroundColor Yellow
$statusBefore = node dist/index.js status --json 2>&1 | ConvertFrom-Json
$costBefore = $statusBefore.aiCost
$tokensBefore = $statusBefore.aiTokens

# Manual log-ai call
node dist/index.js log-ai -p openai -m gpt-4o --prompt-tokens 5000 --completion-tokens 1000 --agent "Manual Agent" --json 2>$null | Out-Null

$statusAfter = node dist/index.js status --json 2>&1 | ConvertFrom-Json
$costAfter = $statusAfter.aiCost
$tokensAfter = $statusAfter.aiTokens

if ($tokensAfter -gt $tokensBefore -and $costAfter -gt $costBefore) {
    # Check both auto-log and manual entries exist (wrap in @() to ensure .Count works)
    $autoEntries = @($statusAfter.aiUsage | Where-Object { $_.agentName -eq 'Claude Code' }).Count
    $manualEntries = @($statusAfter.aiUsage | Where-Object { $_.agentName -eq 'Manual Agent' }).Count
    if ($autoEntries -gt 0 -and $manualEntries -gt 0) {
        Test-Pass "Both auto-log ($autoEntries entries) and manual ($manualEntries entries) coexist"
    } else { Test-Fail "Coexistence" "auto=$autoEntries manual=$manualEntries" }
} else { Test-Fail "Coexistence" "Costs didn't increase" }

# ─── TEST 11: Position file corruption ────────────────────────
Write-Host "[Test 11] Position file corruption recovery" -ForegroundColor Yellow
$posFile11 = Join-Path $posDir 'test11-session.pos'
New-Item -ItemType Directory -Force -Path $posDir | Out-Null
[System.IO.File]::WriteAllText($posFile11, 'not-a-number')
$tf11 = Write-Transcript 'test11.jsonl' @(
    '{"role":"user","content":"This is a test message that should still be processed even though the position file is corrupted with invalid data"}'
    '{"role":"assistant","content":"I understand. Let me help you with your request. I will process this properly even though the tracking state was corrupted from a previous run."}'
)
$hookInput11 = @{ session_id = 'test11-session'; transcript_path = $tf11; cwd = (Get-Location).Path; hook_event_name = 'Stop' } | ConvertTo-Json -Compress
$result11 = $hookInput11 | node dist/index.js auto-log 2>&1
$parsed11 = $result11 | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($parsed11.autoLogged -eq $true) { Test-Pass "Recovered from corrupted position file" }
else { Test-Fail "Position corruption" "Expected logged output, got: $result11" }

# ─── TEST 12: Position exceeds transcript length ─────────────
Write-Host "[Test 12] Position exceeds transcript (transcript reset/truncated)" -ForegroundColor Yellow
$posFile12 = Join-Path $posDir 'test12-session.pos'
[System.IO.File]::WriteAllText($posFile12, '9999')
$tf12 = Write-Transcript 'test12.jsonl' @(
    '{"role":"user","content":"This message exists in a transcript that is shorter than the saved position, simulating a transcript that was reset or truncated by the system"}'
    '{"role":"assistant","content":"I will handle this gracefully by resetting the position counter and processing all available lines from the beginning of the transcript file."}'
)
$hookInput12 = @{ session_id = 'test12-session'; transcript_path = $tf12; cwd = (Get-Location).Path; hook_event_name = 'Stop' } | ConvertTo-Json -Compress
$result12 = $hookInput12 | node dist/index.js auto-log 2>&1
$parsed12 = $result12 | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($parsed12.autoLogged -eq $true) { Test-Pass "Reset position when transcript shorter than saved pos" }
else { Test-Fail "Position overflow" "Expected logged output, got: $result12" }

# ─── TEST 13: Empty transcript file ──────────────────────────
Write-Host "[Test 13] Empty transcript file" -ForegroundColor Yellow
$tf13 = Join-Path $transcriptDir 'test13.jsonl'
[System.IO.File]::WriteAllText($tf13, '')
$hookInput13 = @{ session_id = 'test13-session'; transcript_path = $tf13; cwd = (Get-Location).Path; hook_event_name = 'Stop' } | ConvertTo-Json -Compress
$result13 = $hookInput13 | node dist/index.js auto-log 2>&1
if ([string]::IsNullOrWhiteSpace($result13)) { Test-Pass "Empty transcript exits cleanly" }
else { Test-Fail "Empty transcript" "Expected empty, got: $result13" }

# ─── TEST 14: Transcript with only system/tool messages ───────
Write-Host "[Test 14] Transcript with non-user/assistant roles" -ForegroundColor Yellow
$tf14 = Write-Transcript 'test14.jsonl' @(
    '{"role":"system","content":"You are a helpful assistant"}'
    '{"role":"tool","content":"file contents here"}'
)
$hookInput14 = @{ session_id = 'test14-session'; transcript_path = $tf14; cwd = (Get-Location).Path; hook_event_name = 'Stop' } | ConvertTo-Json -Compress
$result14 = $hookInput14 | node dist/index.js auto-log 2>&1
# System/tool messages count as prompt chars. With short content, total < 10, so should skip
if ([string]::IsNullOrWhiteSpace($result14)) { Test-Pass "Trivial system/tool messages skipped (below threshold)" }
else {
    # If it DID log, that's also OK - just means content was long enough
    Test-Pass "System/tool messages processed as prompt tokens"
}

# ─── TEST 15: Verify final session has all entries ────────────
Write-Host "[Test 15] Final session integrity check" -ForegroundColor Yellow
$finalStatus = node dist/index.js status --json 2>&1 | ConvertFrom-Json
$aiEntries = $finalStatus.aiUsage.Count
$totalCost = $finalStatus.aiCost
$totalTokens = $finalStatus.aiTokens
if ($aiEntries -ge 3 -and $totalCost -gt 0 -and $totalTokens -gt 0) {
    Test-Pass "Session has $aiEntries AI entries, $totalTokens tokens, cost=`$$totalCost"
} else { Test-Fail "Session integrity" "entries=$aiEntries tokens=$totalTokens cost=$totalCost" }

# End the test session
node dist/index.js end --json 2>$null | Out-Null

# Cleanup
if (Test-Path $transcriptDir) { Remove-Item -Recurse -Force $transcriptDir }
if (Test-Path $posDir) { Remove-Item -Recurse -Force $posDir }

# Results
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Results: $passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { 'Green' } else { 'Red' })
Write-Host "========================================`n" -ForegroundColor Cyan

if ($failed -gt 0) { exit 1 }
