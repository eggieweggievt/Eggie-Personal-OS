# ============================================================
#  Chat Buddies - publish latest changes  🐙
#  Right-click -> "Run with PowerShell"
#  Copies the newest files into your Chat-Buddies repo folder,
#  commits, and pushes. GitHub Pages refreshes in ~1 minute.
# ============================================================

$src     = Split-Path -Parent $MyInvocation.MyCommand.Path
$oldDest = "E:\Documents\Claude\Projects\Stream-Avatars"
$dest    = "E:\Documents\Claude\Projects\Chat-Buddies"
$sheet   = "E:\Documents\Claude\Projects\Personal OS\Eggie-Personal-OS\pet-widget\Sprite Sheet.png"
$user    = "eggieweggievt"
$repo    = "chat-buddies"

Write-Host ""
Write-Host "  Publishing Chat Buddies..." -ForegroundColor Magenta
Write-Host ""

# --- one-time migration from the old project name ---
if ((Test-Path $oldDest) -and -not (Test-Path $dest)) {
    Rename-Item $oldDest $dest
    Write-Host "  Renamed local folder Stream-Avatars -> Chat-Buddies" -ForegroundColor Cyan
}
if (-not (Test-Path $dest)) {
    Write-Host "  Project folder not found - run setup.ps1 first." -ForegroundColor Red
    Read-Host  "  Press Enter to close"
    exit
}

# copy everything that belongs on the site
foreach ($f in @("index.html","app.html","picker.html","setup.html","README.md","RUN-THIS-ONCE-supabase.sql","LOCK-IT-DOWN-supabase.sql")) {
    if (Test-Path "$src\$f") { Copy-Item -Force "$src\$f" "$dest\$f" }
}
if (-not (Test-Path "$dest\sheet.png") -and (Test-Path $sheet)) {
    Copy-Item -Force $sheet "$dest\sheet.png"
}

# default gear (frame-animated sheets from the commissioned pack)
if (Test-Path "$src\eggie\gear\burnouts") {
    New-Item -ItemType Directory -Force -Path "$dest\gear" | Out-Null
    Copy-Item -Force "$src\eggie\gear\burnouts\*.png" "$dest\gear\"
    Write-Host "  Default gear copied (axe, crown, guts)." -ForegroundColor Green
}

# ONLY these two commissioned color sheets go public, as preview-only examples.
# The rest of eggie\avatars stays private (also gitignored in Eggie-Personal-OS).
New-Item -ItemType Directory -Force -Path "$dest\skins" | Out-Null
foreach ($s in @("trans","bi")) {
    if (Test-Path "$src\eggie\avatars\$s.png") {
        Copy-Item -Force "$src\eggie\avatars\$s.png" "$dest\skins\$s.png"
    }
}
Write-Host "  Files copied." -ForegroundColor Green

Set-Location $dest

# --- one-time migration: point git at the renamed GitHub repo ---
$remoteUrl = git remote get-url origin 2>$null
if ($remoteUrl -and ($remoteUrl -match "stream-avatars")) {
    git remote set-url origin "https://github.com/$user/$repo.git"
    Write-Host ""
    Write-Host "  ONE-TIME STEP on github.com (do this before pushing):" -ForegroundColor Yellow
    Write-Host "  Open https://github.com/$user/stream-avatars/settings" -ForegroundColor White
    Write-Host "  -> Repository name: change to  chat-buddies  -> Rename" -ForegroundColor White
    Write-Host "  (GitHub Pages follows the rename automatically.)" -ForegroundColor White
    Write-Host ""
    Read-Host  "  Press Enter once you've renamed it (or if you already did)"
}

git add -A
git commit -m "update chat buddies" 2>$null | Out-Null

# grab any changes made on github.com (e.g. web edits, CNAME add/remove)
# so the push is never rejected with "fetch first"
git pull --no-edit origin main 2>$null | Out-Null

# is a GitHub remote set up?
$remote = git remote 2>$null
if (-not $remote) {
    Write-Host ""
    Write-Host "  No GitHub remote yet - one-time manual step:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. Go to https://github.com/new  ->  name it: $repo  ->  Public  ->  Create" -ForegroundColor White
    Write-Host "  2. Paste these, one line at a time:" -ForegroundColor White
    Write-Host ""
    Write-Host "     cd `"$dest`"" -ForegroundColor Cyan
    Write-Host "     git remote add origin https://github.com/$user/$repo.git" -ForegroundColor Cyan
    Write-Host "     git push -u origin main" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  3. On GitHub: Settings -> Pages -> Branch: main, / (root) -> Save" -ForegroundColor White
} else {
    git push
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Pushed! Live in ~1 minute at:" -ForegroundColor Green
    } else {
        Write-Host "  Push failed - check the error above." -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "     Overlay: https://$user.github.io/$repo/?channel=$user" -ForegroundColor Yellow
Write-Host "     Setup:   https://$user.github.io/$repo/setup.html" -ForegroundColor Yellow
Write-Host "     Viewers: https://$user.github.io/$repo/picker.html?channel=$user" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Renamed from stream-avatars? Update the URL in your OBS Browser Source" -ForegroundColor White
Write-Host "  (and the Twitch app's OAuth Redirect URL if you registered one)." -ForegroundColor White
Write-Host ""

$ans = Read-Host "  Open the local test preview (fake avatars)? (y/n)"
if ($ans -eq "y") {
    $u = "file:///" + ($dest -replace "\\","/") + "/index.html?debug=1"
    Start-Process $u
}
Write-Host ""
Read-Host "  Press Enter to close"
