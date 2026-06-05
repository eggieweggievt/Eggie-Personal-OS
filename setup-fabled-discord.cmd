@echo off
REM ============================================================
REM  Hook Fabled (Discord ID 376662817081655298) into the bot:
REM   1. sets DISCORD_USER_MAP + REMINDER_USERS secrets
REM   2. deploys the multi-user reminders cron
REM   3. deploys analyze (persona + sources changes)
REM   4. deploys discord (safe to re-deploy)
REM  Prereq: the Eugene-on-Discord setup (bot token etc.) is done.
REM ============================================================
cd /d "%~dp0"

if not defined SUPABASE_ACCESS_TOKEN (
  echo If the Supabase CLI is already logged in, just press Enter.
  set /p SUPABASE_ACCESS_TOKEN="SUPABASE_ACCESS_TOKEN (sbp_...): "
)

echo.
echo === setting secrets ===
call npx supabase secrets set --env-file fabled-discord.env --project-ref clpfyxlenotepuceczbh
if errorlevel 1 ( echo [!] secrets failed — is the access token right? & pause & exit /b 1 )

echo.
echo === deploying reminders (multi-user cron) ===
call npx supabase functions deploy reminders --no-verify-jwt --project-ref clpfyxlenotepuceczbh
if errorlevel 1 ( echo [!] reminders deploy failed & pause & exit /b 1 )

echo.
echo === deploying analyze (persona + sources) ===
call npx supabase functions deploy analyze --no-verify-jwt --project-ref clpfyxlenotepuceczbh
if errorlevel 1 ( echo [!] analyze deploy failed & pause & exit /b 1 )

echo.
echo === deploying discord (no harm if unchanged) ===
call npx supabase functions deploy discord --no-verify-jwt --project-ref clpfyxlenotepuceczbh

echo.
echo === DONE ===
echo Fabled now gets reminder DMs with done/snooze buttons, and his
echo /ask /remind /task /today commands hit HIS data.
echo Remember: he must share a server with the bot (or user-install it)
echo or Discord won't allow DMs.
pause
