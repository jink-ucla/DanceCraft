<#
.SYNOPSIS
  DanceCraft / Groovy one-time setup for Windows (Windows PowerShell 5.1+).

.DESCRIPTION
  - Checks node, npm, python, ffmpeg and yt-dlp (warns if Node < 20)
  - Picks a Python that has mediapipe wheels (py -3.11 / -3.12 / -3.10, else python on PATH)
  - Creates .venv and installs mediapipe, opencv-python-headless, numpy, yt-dlp into it
  - Downloads scripts\pose_landmarker_heavy.task if missing
  - Creates .env from .env.example if missing and sets PYTHON_PATH=.venv/Scripts/python.exe
  Never writes API keys.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -SkipPip

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Python "C:\Python312\python.exe"
#>
[CmdletBinding()]
param(
  # Skip "pip install" into .venv (venv is still created if missing).
  [switch]$SkipPip,
  # Skip downloading the MediaPipe pose model.
  [switch]$SkipModel,
  # Skip "npm install" when node_modules is missing.
  [switch]$SkipNpm,
  # Use this Python interpreter to create .venv instead of auto-detecting.
  [string]$Python = ''
)

# Native tools write to stderr; keep 'Continue' so PS 5.1 does not turn that
# into terminating errors. Cmdlets that must succeed use -ErrorAction Stop.
$ErrorActionPreference = 'Continue'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$VenvDir = Join-Path $RepoRoot '.venv'
$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'
$ModelPath = Join-Path $RepoRoot 'scripts\pose_landmarker_heavy.task'
$ModelUrl = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task'
$EnvPath = Join-Path $RepoRoot '.env'
$EnvExamplePath = Join-Path $RepoRoot '.env.example'
$EnvPythonValue = '.venv/Scripts/python.exe'
$PipPackages = @('mediapipe', 'opencv-python-headless', 'numpy', 'yt-dlp')

$script:Summary = New-Object System.Collections.Generic.List[object]
$script:Warnings = New-Object System.Collections.Generic.List[string]

function Write-Step([string]$Text) {
  Write-Host ''
  Write-Host "==> $Text" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) { Write-Host "  [ok]   $Text" -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host "         $Text" -ForegroundColor Gray }

function Write-Warn([string]$Text) {
  Write-Host "  [warn] $Text" -ForegroundColor Yellow
  $script:Warnings.Add($Text)
}

function Add-Summary([string]$Item, [string]$Status, [string]$Detail) {
  $script:Summary.Add([pscustomobject]@{ Item = $Item; Status = $Status; Detail = $Detail })
}

# Run a native command, capture stdout (stderr discarded), never throw.
function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments = @())
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $result = [pscustomobject]@{ ExitCode = -1; Output = '' }
  try {
    $out = & $Exe @Arguments 2>$null
    $text = (($out | ForEach-Object { "$_" }) -join "`n").Trim()
    $result = [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $text }
  } catch {
    $result = [pscustomobject]@{ ExitCode = -1; Output = '' }
  } finally {
    $ErrorActionPreference = $prev
  }
  return $result
}

function Get-FirstLine([string]$Text) {
  if (-not $Text) { return '' }
  return ($Text -split "`n")[0].Trim()
}

function Test-Tool([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# Returns @{ Version = [version]; Text = '3.11.9' } or $null.
function Get-PythonVersion {
  param([string]$Exe, [string[]]$PrefixArgs = @())
  # Single quotes only inside the code: PS 5.1 mangles embedded double quotes in native args.
  $probe = Invoke-Native $Exe ($PrefixArgs + @('-c', "import sys; print('%d.%d.%d' % sys.version_info[:3])"))
  if ($probe.ExitCode -ne 0) { return $null }
  $line = Get-FirstLine $probe.Output
  if ($line -notmatch '^\d+\.\d+\.\d+$') { return $null }
  return @{ Version = [version]$line; Text = $line }
}

function Test-MediapipeFriendly([version]$Version) {
  return ($Version -ge [version]'3.9.0') -and ($Version -lt [version]'3.13.0')
}

# Reads KEY=VALUE from .env lines (last one wins), ignoring comments.
function Get-DotEnvValue([string[]]$Lines, [string]$Key) {
  $value = $null
  foreach ($line in $Lines) {
    if ($line -match ('^\s*(export\s+)?' + [regex]::Escape($Key) + '\s*=\s*(.*)$')) {
      $v = $Matches[2].Trim()
      if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
        $v = $v.Substring(1, $v.Length - 2)
      }
      $value = $v
    }
  }
  return $value
}

Write-Host 'DanceCraft setup for Windows' -ForegroundColor Magenta
Write-Info "Repo: $RepoRoot"
Write-Info "PowerShell: $($PSVersionTable.PSVersion)"

# ---------------------------------------------------------------------------
# 1) Tools
# ---------------------------------------------------------------------------
Write-Step 'Checking tools'

$nodeOk = $false
if (Test-Tool 'node') {
  $nodeVer = Get-FirstLine (Invoke-Native 'node' @('--version')).Output
  $nodeMajor = 0
  if ($nodeVer -match '^v?(\d+)\.') { $nodeMajor = [int]$Matches[1] }
  if ($nodeMajor -ge 20) {
    Write-Ok "node $nodeVer"
    Add-Summary 'node' 'ok' $nodeVer
    $nodeOk = $true
  } else {
    Write-Warn "node $nodeVer is too old - Node 20+ is required (winget install OpenJS.NodeJS.LTS)"
    Add-Summary 'node' 'old' $nodeVer
  }
} else {
  Write-Warn 'node not found - install Node 20+ (winget install OpenJS.NodeJS.LTS), then reopen the terminal'
  Add-Summary 'node' 'missing' 'winget install OpenJS.NodeJS.LTS'
}

$npmOk = $false
if (Test-Tool 'npm') {
  $npmVer = Get-FirstLine (Invoke-Native 'npm' @('--version')).Output
  Write-Ok "npm $npmVer"
  Add-Summary 'npm' 'ok' $npmVer
  $npmOk = $true
} else {
  Write-Warn 'npm not found (it ships with Node.js)'
  Add-Summary 'npm' 'missing' 'comes with Node.js'
}

if (Test-Tool 'ffmpeg') {
  $ffLine = Get-FirstLine (Invoke-Native 'ffmpeg' @('-version')).Output
  $ffVer = $ffLine
  if ($ffLine -match 'ffmpeg version (\S+)') { $ffVer = $Matches[1] }
  Write-Ok "ffmpeg $ffVer"
  Add-Summary 'ffmpeg' 'ok' $ffVer
} else {
  Write-Warn 'ffmpeg not found - needed for YouTube imports and dance thumbnails (winget install Gyan.FFmpeg). Local add-dance works without it.'
  Add-Summary 'ffmpeg' 'missing' 'winget install Gyan.FFmpeg (optional for local dances)'
}

if (Test-Tool 'yt-dlp') {
  $ytVer = Get-FirstLine (Invoke-Native 'yt-dlp' @('--version')).Output
  Write-Ok "yt-dlp $ytVer"
  Add-Summary 'yt-dlp' 'ok' $ytVer
} else {
  Write-Warn 'yt-dlp not on PATH - only needed for "+ Add Dance" from YouTube (winget install yt-dlp.yt-dlp)'
  Add-Summary 'yt-dlp' 'missing' 'winget install yt-dlp.yt-dlp (optional)'
}

# ---------------------------------------------------------------------------
# 2) npm dependencies
# ---------------------------------------------------------------------------
if (-not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
  if ($SkipNpm) {
    Write-Warn 'node_modules missing - run "npm install"'
    Add-Summary 'npm install' 'skipped' 'run npm install'
  } elseif ($npmOk -and $nodeOk) {
    Write-Step 'Installing npm dependencies (npm install)'
    Push-Location $RepoRoot
    try {
      & npm install
      $npmExit = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    if ($npmExit -eq 0) {
      Add-Summary 'npm install' 'ok' ''
    } else {
      Write-Warn "npm install failed (exit $npmExit)"
      Add-Summary 'npm install' 'failed' "exit $npmExit"
    }
  } else {
    Write-Warn 'node_modules missing and Node/npm unavailable - install Node 20+ then run "npm install"'
    Add-Summary 'npm install' 'missing' 'install Node 20+, then npm install'
  }
} else {
  Add-Summary 'npm install' 'ok' 'node_modules present'
}

# ---------------------------------------------------------------------------
# 3) Python + .venv
# ---------------------------------------------------------------------------
Write-Step 'Python for the pose pipeline'

$venvReady = $false
if (Test-Path $VenvPython) {
  $venvVer = Get-PythonVersion $VenvPython
  if ($null -eq $venvVer) {
    Write-Warn ".venv exists but $VenvPython does not run. Delete the .venv folder and re-run this script."
    Add-Summary '.venv' 'broken' 'delete .venv and re-run'
  } else {
    Write-Ok ".venv already exists (Python $($venvVer.Text))"
    if (-not (Test-MediapipeFriendly $venvVer.Version)) {
      Write-Warn ".venv uses Python $($venvVer.Text); mediapipe wheels may not exist for it. Recommended: delete .venv, install Python 3.11 or 3.12 (winget install Python.Python.3.12) and re-run."
    }
    Add-Summary '.venv' 'ok' "Python $($venvVer.Text)"
    $venvReady = $true
  }
} else {
  if (Test-Path $VenvDir) {
    Write-Warn ".venv exists but has no Scripts\python.exe (created on another OS?). Delete the .venv folder and re-run."
    Add-Summary '.venv' 'broken' 'delete .venv and re-run'
  } else {
    # Pick a base interpreter.
    $baseExe = $null
    $baseArgs = @()
    $baseVer = $null
    $baseLabel = ''

    if ($Python) {
      $v = Get-PythonVersion $Python
      if ($null -ne $v) {
        $baseExe = $Python; $baseVer = $v; $baseLabel = $Python
      } else {
        Write-Warn "-Python '$Python' did not run."
      }
    }

    if ($null -eq $baseExe -and (Test-Tool 'py')) {
      foreach ($tag in @('-3.11', '-3.12', '-3.10')) {
        $v = Get-PythonVersion 'py' @($tag)
        if ($null -ne $v) {
          $baseExe = 'py'; $baseArgs = @($tag); $baseVer = $v; $baseLabel = "py $tag"
          break
        }
      }
    }

    if ($null -eq $baseExe) {
      foreach ($candidate in @('python', 'python3')) {
        if (Test-Tool $candidate) {
          $v = Get-PythonVersion $candidate
          if ($null -ne $v) {
            $baseExe = $candidate; $baseVer = $v; $baseLabel = $candidate
            break
          }
        }
      }
    }

    if ($null -eq $baseExe -and (Test-Tool 'py')) {
      $v = Get-PythonVersion 'py' @('-3')
      if ($null -ne $v) { $baseExe = 'py'; $baseArgs = @('-3'); $baseVer = $v; $baseLabel = 'py -3' }
    }

    if ($null -eq $baseExe) {
      Write-Warn 'No working Python found. Install Python 3.12 (winget install Python.Python.3.12), reopen the terminal and re-run. (The "python" command that opens the Microsoft Store does not count.)'
      Add-Summary 'python' 'missing' 'winget install Python.Python.3.12'
    } else {
      Write-Ok "Using $baseLabel (Python $($baseVer.Text))"
      Add-Summary 'python' 'ok' "$baseLabel -> $($baseVer.Text)"
      if (-not (Test-MediapipeFriendly $baseVer.Version)) {
        Write-Warn "Python $($baseVer.Text): mediapipe wheels may not exist for Python >= 3.13 (or < 3.9). Recommended: install Python 3.11 or 3.12 (winget install Python.Python.3.12) and re-run."
      }
      Write-Step "Creating .venv with $baseLabel"
      & $baseExe @($baseArgs + @('-m', 'venv', $VenvDir))
      if ($LASTEXITCODE -eq 0 -and (Test-Path $VenvPython)) {
        Write-Ok "Created $VenvDir"
        Add-Summary '.venv' 'created' "Python $($baseVer.Text)"
        $venvReady = $true
      } else {
        Write-Warn "Failed to create .venv (exit $LASTEXITCODE)"
        Add-Summary '.venv' 'failed' "exit $LASTEXITCODE"
      }
    }
  }
}

# ---------------------------------------------------------------------------
# 4) pip install
# ---------------------------------------------------------------------------
if ($SkipPip) {
  Add-Summary 'pip packages' 'skipped' '-SkipPip'
} elseif ($venvReady) {
  Write-Step "Installing $($PipPackages -join ', ') into .venv"
  & $VenvPython -m pip install --upgrade pip
  & $VenvPython @(@('-m', 'pip', 'install') + $PipPackages)
  $pipExit = $LASTEXITCODE
  if ($pipExit -ne 0) {
    Write-Warn "pip install failed (exit $pipExit). If it says no matching distribution for mediapipe, use Python 3.11/3.12: delete .venv and re-run."
    Add-Summary 'pip packages' 'failed' "exit $pipExit"
  } else {
    $check = Invoke-Native $VenvPython @('-c', 'import mediapipe, cv2, numpy; print(mediapipe.__version__)')
    if ($check.ExitCode -eq 0) {
      $mpVer = Get-FirstLine $check.Output
      Write-Ok "mediapipe $mpVer imports fine"
      Add-Summary 'pip packages' 'ok' "mediapipe $mpVer"
    } else {
      Write-Warn 'Packages installed but "import mediapipe, cv2, numpy" failed. Try Python 3.11/3.12 (delete .venv and re-run).'
      Add-Summary 'pip packages' 'failed' 'import check failed'
    }
  }
} else {
  Add-Summary 'pip packages' 'skipped' 'no working .venv'
}

# ---------------------------------------------------------------------------
# 5) MediaPipe model
# ---------------------------------------------------------------------------
Write-Step 'MediaPipe pose model'
if (Test-Path $ModelPath) {
  $sizeMb = [math]::Round((Get-Item $ModelPath).Length / 1MB, 1)
  Write-Ok "scripts\pose_landmarker_heavy.task present ($sizeMb MB)"
  Add-Summary 'pose model' 'ok' "$sizeMb MB"
} elseif ($SkipModel) {
  Write-Warn 'Model missing (skipped download)'
  Add-Summary 'pose model' 'skipped' '-SkipModel'
} else {
  $tmpModel = "$ModelPath.download"
  $prevProgress = $ProgressPreference
  try {
    Write-Info "Downloading $ModelUrl"
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'  # the PS 5.1 progress bar makes downloads very slow
    Invoke-WebRequest -Uri $ModelUrl -OutFile $tmpModel -UseBasicParsing -ErrorAction Stop
    if ((Get-Item $tmpModel).Length -lt 1MB) { throw 'downloaded file is unexpectedly small' }
    Move-Item -Path $tmpModel -Destination $ModelPath -Force -ErrorAction Stop
    $sizeMb = [math]::Round((Get-Item $ModelPath).Length / 1MB, 1)
    Write-Ok "Downloaded scripts\pose_landmarker_heavy.task ($sizeMb MB)"
    Add-Summary 'pose model' 'downloaded' "$sizeMb MB"
  } catch {
    Write-Warn "Model download failed: $($_.Exception.Message)"
    Write-Info "Manual: Invoke-WebRequest -Uri '$ModelUrl' -OutFile 'scripts\pose_landmarker_heavy.task'"
    Add-Summary 'pose model' 'failed' 'see manual command above'
    if (Test-Path $tmpModel) { Remove-Item $tmpModel -Force -ErrorAction SilentlyContinue }
  } finally {
    $ProgressPreference = $prevProgress
  }
}

# ---------------------------------------------------------------------------
# 6) .env
# ---------------------------------------------------------------------------
Write-Step '.env'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
if (-not (Test-Path $EnvPath)) {
  if (Test-Path $EnvExamplePath) {
    Copy-Item -Path $EnvExamplePath -Destination $EnvPath -ErrorAction Stop
    Write-Ok 'Created .env from .env.example'
  } else {
    [System.IO.File]::WriteAllText($EnvPath, '', $utf8NoBom)
    Write-Ok 'Created empty .env'
  }
}

$envText = [System.IO.File]::ReadAllText($EnvPath)
$newline = "`n"
if ($envText.Contains("`r`n")) { $newline = "`r`n" }
$envLines = @()
if ($envText.Length -gt 0) { $envLines = @($envText -split "\r?\n") }

$currentPy = Get-DotEnvValue $envLines 'PYTHON_PATH'
$keepCurrent = $false
if ($currentPy) {
  if ($currentPy -eq $EnvPythonValue -or $currentPy -eq '.venv\Scripts\python.exe') {
    $keepCurrent = $true
    Write-Ok "PYTHON_PATH already set to $currentPy"
  } else {
    $resolvedPy = $currentPy
    if (-not [System.IO.Path]::IsPathRooted($currentPy)) { $resolvedPy = Join-Path $RepoRoot $currentPy }
    if (Test-Path $resolvedPy) {
      $keepCurrent = $true
      Write-Ok "Keeping existing PYTHON_PATH=$currentPy (it exists)"
    }
  }
}

if (-not $keepCurrent) {
  $replaced = $false
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($line in $envLines) {
    if ($line -match '^\s*(export\s+)?PYTHON_PATH\s*=') {
      if (-not $replaced) {
        $out.Add("PYTHON_PATH=$EnvPythonValue")
        $replaced = $true
      }
      # drop duplicate PYTHON_PATH lines
    } else {
      $out.Add($line)
    }
  }
  if (-not $replaced) {
    while ($out.Count -gt 0 -and $out[$out.Count - 1].Trim() -eq '') { $out.RemoveAt($out.Count - 1) }
    if ($out.Count -gt 0) { $out.Add('') }
    $out.Add('# Python interpreter for the offline pose pipeline (scripts/extract_poses.py)')
    $out.Add("PYTHON_PATH=$EnvPythonValue")
  }
  $body = ($out -join $newline).TrimEnd() + $newline
  [System.IO.File]::WriteAllText($EnvPath, $body, $utf8NoBom)
  if ($currentPy) {
    Write-Ok "PYTHON_PATH updated: $currentPy -> $EnvPythonValue (old path did not exist)"
  } else {
    Write-Ok "PYTHON_PATH=$EnvPythonValue written to .env"
  }
}
Add-Summary '.env' 'ok' 'PYTHON_PATH set'

$finalLines = @([System.IO.File]::ReadAllText($EnvPath) -split "\r?\n")
$apiKeySet = [bool](Get-DotEnvValue $finalLines 'ANTHROPIC_API_KEY')
if (-not $apiKeySet -and $env:ANTHROPIC_API_KEY) { $apiKeySet = $true }
if ($apiKeySet) {
  Add-Summary 'ANTHROPIC_API_KEY' 'set' 'AI Coach uses Claude'
} else {
  Add-Summary 'ANTHROPIC_API_KEY' 'not set' 'AI Coach falls back to the built-in coach'
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Step 'Summary'
foreach ($row in $script:Summary) {
  $color = 'Green'
  if ($row.Status -in @('missing', 'failed', 'broken', 'old')) { $color = 'Red' } elseif ($row.Status -in @('skipped', 'not set')) { $color = 'Yellow' }
  Write-Host ('  {0,-18} {1,-10} {2}' -f $row.Item, $row.Status, $row.Detail) -ForegroundColor $color
}
if ($script:Warnings.Count -gt 0) {
  Write-Host ''
  Write-Host "  $($script:Warnings.Count) warning(s) above - fix those first." -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Magenta
if (-not $apiKeySet) {
  Write-Host '  1. (Optional, for the Claude coach) add this line to .env:  ANTHROPIC_API_KEY=<your key>'
} else {
  Write-Host '  1. ANTHROPIC_API_KEY is configured - the AI Coach will use Claude.'
}
Write-Host '  2. Add the host dance:  npm run add-dance -- path\to\wasil.mp4 --id wasil --title "Beat Wasil" --host Wasil'
Write-Host '  3. Start the app:       npm run dev     then open http://localhost:5173 in Chrome or Edge'
Write-Host '  Runbook: docs\dancecraft.md'
