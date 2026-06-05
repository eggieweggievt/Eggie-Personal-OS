# ============================================================
#  Chat Buddies - one-time setup  🐙
#  Right-click this file -> "Run with PowerShell"
#  (If Windows blocks it: open PowerShell and run:
#     powershell -ExecutionPolicy Bypass -File "E:\Documents\Claude\Projects\Personal OS\Eggie-Personal-OS\stream-avatars\setup.ps1" )
#
#  What it does:
#   1. Creates the project folder  E:\Documents\Claude\Projects\Chat-Buddies
#   2. Copies index.html + README there
#   3. Copies your Eggie sprite sheet there as sheet.png
#   4. Sets up git and makes the first commit
#   5. Pushes to GitHub automatically if you have the "gh" tool,
#      otherwise prints the exact commands to paste
# ============================================================

$src   = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest  = "E:\Documents\Claude\Projects\Chat-Buddies"
$sheet = "E:\Documents\Claude\Projects\Personal OS\Eggie-Personal-OS\pet-widget\Sprite Sheet.png"
$user  = "eggieweggievt"
$repo  = "chat-buddies"

Write-Host ""
Write-Host "  Chat Buddies setup starting..." -ForegroundColor Magenta
Write-Host ""

# --- 1. project folder ---
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host "  [1/5] Folder ready: $dest" -ForegroundColor Green

# --- 2. copy files ---
Copy-Item -Force "$src\index.html" "$dest\index.html"
Copy-Item -Force "$src\README.md"  "$dest\README.md"
Write-Host "  [2/5] index.html + README copied" -ForegroundColor Green

# --- 3. sprite sheet ---
if (Test-Path $sheet) {
    Copy-Item -Force $sheet "$dest\sheet.png"
    Write-Host "  [3/5] Sprite sheet copied as sheet.png" -ForegroundColor Green
} else {
    Write-Host "  [3/5] Could not find the sprite sheet at:" -ForegroundColor Yellow
    Write-Host "        $sheet" -ForegroundColor Yellow
    Write-Host "        Copy it into $dest yourself and name it sheet.png" -ForegroundColor Yellow
}

# --- 4. git ---
Set-Location $dest
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  [4/5] git is not installed - install it from https://git-scm.com then re-run this script" -ForegroundColor Red
    Read-Host "  Press Enter to close"
    exit
}
if (-not (Test-Path "$dest\.git")) { git init -b main | Out-Null }
git add -A
git commit -m "stream avatars v1" 2>$null | Out-Null
Write-Host "  [4/5] git repo ready + committed" -ForegroundColor Green

# --- 5. push to GitHub ---
$gh = Get-Command gh -ErrorAction SilentlyContinue
$pushed = $false
if ($gh) {
    Write-Host "  [5/5] Found GitHub CLI - creating repo + pushing..." -ForegroundColor Cyan
    gh repo create $repo --public --source . --push 2>$null
    if ($LASTEXITCODE -eq 0) {
        $pushed = $true
        # try to switch on GitHub Pages too
        gh api "repos/$user/$repo/pages" --method POST -f "source[branch]=main" -f "source[path]=/" 2>$null | Out-Null
    }
}

Write-Host ""
if ($pushed) {
    Write-Host "  All done! Your overlay will be live in ~1 minute at:" -ForegroundColor Magenta
} else {
    Write-Host "  Last step is manual (one time only):" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "  1. In your browser, go to https://github.com/new" -ForegroundColor White
    Write-Host "     Repository name: $repo   ->  keep it Public  ->  Create repository" -ForegroundColor White
    Write-Host ""
    Write-Host "  2. Then paste these in PowerShell, one line at a time:" -ForegroundColor White
    Write-Host ""
    Write-Host "     cd `"$dest`"" -ForegroundColor Cyan
    Write-Host "     git remote add origin https://github.com/$user/$repo.git" -ForegroundColor Cyan
    Write-Host "     git push -u origin main" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  3. On GitHub: repo Settings -> Pages -> Branch: main, folder / (root) -> Save" -ForegroundColor White
    Write-Host ""
    Write-Host "  Your overlay URL will be:" -ForegroundColor Magenta
}
Write-Host ""
Write-Host "     https://$user.github.io/$repo/?channel=$user" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Paste that URL into an OBS Browser Source (1920x1080, 60 FPS)." -ForegroundColor White
Write-Host "  Full OBS settings + chat commands are in README.md" -ForegroundColor White
Write-Host ""

# --- offer a local test preview ---
$ans = Read-Host "  Open a test preview with 20 fake avatars now? (y/n)"
if ($ans -eq "y") {
    $u = "file:///" + ($dest -replace "\\","/") + "/index.html?debug=1"
    Start-Process $u
}
Write-Host ""
Read-Host "  Press Enter to close"
