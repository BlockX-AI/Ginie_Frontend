# Force complete rebuild and cache clear

Write-Host "Stopping all Node processes..." -ForegroundColor Yellow
Get-Process | Where-Object {$_.ProcessName -like "*node*"} | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Deleting .next build cache..." -ForegroundColor Yellow
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue

Write-Host "Deleting node_modules/.cache..." -ForegroundColor Yellow
Remove-Item -Recurse -Force node_modules/.cache -ErrorAction SilentlyContinue

Write-Host "Starting dev server..." -ForegroundColor Green
npm run dev
