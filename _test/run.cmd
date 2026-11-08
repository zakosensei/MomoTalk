@echo off
rem MomoTalk QA harness launcher (Windows cmd).
rem Usage: run.cmd              -> all scenarios
rem        run.cmd -Scenario render,more
rem        run.cmd -Shot         -> screenshots to _test\shots\*.png
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
exit /b %ERRORLEVEL%
