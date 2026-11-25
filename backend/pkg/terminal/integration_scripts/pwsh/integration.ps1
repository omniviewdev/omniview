# Omniview shell integration for PowerShell: the command the host starts pwsh with (-NoExit -Command ". <this file>").
#
# Provenance: written for Omniview from the protocol (OSC 133 semantic prompts, OSC 7 and the 633;E / 633;P marks of
# VS Code's shell integration) and from the documentation of PowerShell's prompt function, of PSReadLine and of
# PSConsoleHostReadLine. No line is copied from another project's script. VS Code (MIT) was read as a reference for the
# idea of wrapping the prompt and PSConsoleHostReadLine only; the scripts of Ghostty, kitty, iTerm2, Zed and Warp
# (copyleft) were not read for this file.
#
# The host starts pwsh with -Login -NoLogo -NoExit and this file as its command, so the user's profile has run when this
# file does, and the user's own prompt is the one that is wrapped. The host sends two lines on file descriptor 3, a
# socket: the session's nonce, and a line pwsh does not use. The nonce is kept in a variable of this session that is not
# in the environment. The file writes "ready" to the socket when it is done, and closes it.
& {
    $ErrorActionPreference = 'SilentlyContinue'
    $nonce = $null
    $socket = $null
    try {
        $handle = [System.Net.Sockets.SafeSocketHandle]::new([IntPtr]3, $true)
        $socket = [System.Net.Sockets.Socket]::new($handle)
        $socket.ReceiveTimeout = 5000
        $lines = [System.Collections.Generic.List[string]]::new()
        $line = [System.Text.StringBuilder]::new()
        $byte = [byte[]]::new(1)
        while ($lines.Count -lt 2 -and $socket.Receive($byte) -eq 1) {
            if ($byte[0] -eq 10) { $lines.Add($line.ToString()); [void]$line.Clear() } else { [void]$line.Append([char]$byte[0]) }
        }
        if ($lines.Count -eq 2 -and $lines[0].Length -gt 0) { $nonce = $lines[0] }
    } catch { $nonce = $null }
    if ($null -eq $nonce) { if ($socket) { $socket.Dispose() }; return }
    $global:__omniview_nonce = $nonce
    $global:__omniview_ran = $false
    $global:__omniview_error = $null
    $global:__omniview_userPrompt = $function:prompt

    # __omniview_escape: the text as a mark carries it: at most 4096 characters, \ ; and every control character as \xHH.
    function global:__omniview_escape([string]$Text) {
        if ($Text.Length -gt 4096) { $Text = $Text.Substring(0, 4096) }
        [regex]::Replace($Text, '[\x00-\x1f\x7f\\;]', { param($m) '\x{0:x2}' -f [int][char]$m.Value })
    }

    function global:__omniview_pathEncoded([string]$Path) {
        [regex]::Replace($Path, '[^a-zA-Z0-9/._~-]', { param($m) ([System.Text.Encoding]::UTF8.GetBytes($m.Value) | ForEach-Object { '%{0:X2}' -f $_ }) -join '' })
    }

    # The prompt: the end of the last command with its status, the directory, the prompt marks around the user's prompt.
    function global:prompt {
        $succeeded = $?
        $lastExit = $global:LASTEXITCODE
        $esc = [char]27; $bel = [char]7
        $text = ''
        if ($global:__omniview_ran) {
            $global:__omniview_ran = $false
            # PowerShell tells a native command's code and a cmdlet's failure apart by what the command left behind: an error
            # record that is new is a cmdlet's (the status is 1), else the code of the native command.
            $status = 0
            if (-not $succeeded) {
                $status = 1
                if ([object]::ReferenceEquals($global:Error[0], $global:__omniview_error) -and $lastExit -is [int] -and $lastExit -ne 0) { $status = $lastExit }
            }
            $text += "$esc]133;D;$status$bel"
        }
        $location = $ExecutionContext.SessionState.Path.CurrentFileSystemLocation
        if ($location) {
            $cwd = $location.ProviderPath
            $text += "$esc]7;file://$([System.Environment]::MachineName)$(__omniview_pathEncoded $cwd)$bel"
            $text += "$esc]633;P;Cwd=$(__omniview_escape $cwd);$($global:__omniview_nonce)$bel"
        }
        $text += "$esc]133;A$bel"
        $userText = & $global:__omniview_userPrompt
        $global:LASTEXITCODE = $lastExit
        "$text$userText$esc]133;B$bel"
    }

    # The line the user entered, as typed, with the nonce, then the start of the output. PSReadLine's own read is wrapped.
    function global:PSConsoleHostReadLine {
        $lastRunStatus = $?
        $line = [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine($Host.Runspace, $ExecutionContext, $lastRunStatus)
        # An empty line (or one of blanks) runs no command: no mark, as in the other shells.
        if ($line -and $line.Trim().Length -gt 0) {
            $esc = [char]27; $bel = [char]7
            [Console]::Write("$esc]633;E;$(__omniview_escape $line);$($global:__omniview_nonce)$bel$esc]133;C$bel")
            $global:__omniview_ran = $true
            $global:__omniview_error = $global:Error[0]
        }
        $line
    }

    [void]$socket.Send([System.Text.Encoding]::ASCII.GetBytes("ready`n"))
    $socket.Dispose()
}
