$dllPath = 'F:\project\nextpanel\node_modules\.pnpm\@prisma+client@5.22.0_prisma@5.22.0\node_modules\.prisma\client\query_engine-windows.dll.node'
$processes = Get-Process node -ErrorAction SilentlyContinue
foreach ($p in $processes) {
  try {
    $modules = $p.Modules | Where-Object { $_.FileName -eq $dllPath }
    if ($modules) { Write-Output "PID: $($p.Id)" }
  } catch {}
}
