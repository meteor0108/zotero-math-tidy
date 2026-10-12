# Packs addon/ into build/math-tidy.xpi.
# Compress-Archive writes backslash paths in Windows PowerShell 5.1, which Zotero can't read,
# so the archive is written entry by entry with forward slashes.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$source = Join-Path $PSScriptRoot "addon"
$outDir = Join-Path $PSScriptRoot "build"
$xpi = Join-Path $outDir "math-tidy.xpi"

New-Item -ItemType Directory -Force $outDir | Out-Null
if (Test-Path $xpi) { Remove-Item $xpi }

$zip = [System.IO.Compression.ZipFile]::Open($xpi, [System.IO.Compression.ZipArchiveMode]::Create)
try {
	Get-ChildItem $source -Recurse -File | ForEach-Object {
		$entry = $_.FullName.Substring($source.Length + 1).Replace("\", "/")
		[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry) | Out-Null
	}
}
finally {
	$zip.Dispose()
}
Write-Output "Built $xpi"
