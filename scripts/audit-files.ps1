$dir = "C:\Users\Lenovo\Documents\dashboard-keuangan-tiktok\data tiktok\custombase"
Write-Host "=== A. CURRENT DIRECTORY ==="
Write-Host (Get-Location).Path
Write-Host ""

Write-Host "=== B. OS/RUNTIME ==="
Write-Host "OS: $([Environment]::OSVersion.VersionString)"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host ""

Write-Host "=== C. TEST-PATH FOLDER ==="
$exists = Test-Path -LiteralPath $dir
Write-Host "Folder exists: $exists"
Write-Host ""

Write-Host "=== D. SEMUA XLSX DALAM FOLDER ==="
Get-ChildItem -LiteralPath $dir -File -Filter "*.xlsx" | ForEach-Object {
    $sizeKB = [math]::Round($_.Length / 1KB, 1)
    Write-Host ("  {0,-55} {1,8} KB  {2}" -f $_.Name, $sizeKB, $_.LastWriteTime)
}
Write-Host ""

Write-Host "=== E. WILDCARD SEARCH 'iklan|ads|juli|agustus' ==="
$matches = Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Name -match "iklan|ads|juli|agustus" }
if ($matches.Count -eq 0) {
    Write-Host "  TIDAK DITEMUKAN file dengan pattern 'iklan|ads|juli|agustus'"
} else {
    foreach ($f in $matches) {
        Write-Host ("  {0}  ({1} KB)" -f $f.FullName, [math]::Round($f.Length/1KB,1))
    }
}
Write-Host ""

Write-Host "=== F. SEMUA FILE MENGANDUNG 'iklan' ==="
$iklanFiles = Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Name -like "*iklan*" -or $_.Name -like "*ads*" }
foreach ($f in $iklanFiles) {
    Write-Host ("  FULLNAME: {0}" -f $f.FullName)
    Write-Host ("  NAME: {0}" -f $f.Name)
    Write-Host ("  SIZE: {0} bytes" -f $f.Length)
    Write-Host ("  TIME: {0}" -f $f.LastWriteTime)
    Write-Host ""
}

if ($iklanFiles.Count -eq 0) {
    Write-Host "  TIDAK ADA FILE dengan 'iklan' atau 'ads' dalam nama"
}
Write-Host ""

Write-Host "=== G. EXPLICIT TEST-PATH untuk iklan 1juli-sekarang.xlsx ==="
$testPath = "C:\Users\Lenovo\Documents\dashboard-keuangan-tiktok\data tiktok\custombase\iklan 1juli-sekarang.xlsx"
Write-Host "Test-Path '$testPath': $(Test-Path -LiteralPath $testPath)"
Write-Host ""

Write-Host "=== H. SCAN HEADER SEMUA XLSX UNTUK KLASIFIKASI ==="
# Use Node.js for XLSX reading since PowerShell doesn't have XLSX support
Write-Host "  (akan dijalankan via Node.js di langkah berikutnya)"
Write-Host ""

Write-Host "=== KESIMPULAN ==="
Write-Host "Total file XLSX di folder: $((Get-ChildItem -LiteralPath $dir -File -Filter '*.xlsx').Count)"
Write-Host "File dengan 'iklan' dalam nama: $($iklanFiles.Count)"
Write-Host "iklan 1juli-sekarang.xlsx: $(if(Test-Path -LiteralPath $testPath){'ADA'}else{'TIDAK ADA'})"
