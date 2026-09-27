# 生成 Chrome Web Store 发布包
# 用法：powershell -NoProfile -File tools\package.ps1 [-Version 1.0.0]
param(
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$staging = Join-Path $env:TEMP "mdv-store-package"
$dist = Join-Path $root "dist"
$zip = Join-Path $dist "markdown-viewer-chrome-v$Version.zip"

# 1) 组装干净的暂存目录（排除开发专用文件）
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
robocopy $root $staging /E /NFL /NDL /NJH /NJS /NP `
    /XD tools .git dist .shots node_modules store-assets `
    /XF preview.html README.md demo.md package.ps1 package.mjs
# robocopy 退出码 0-7 均视为成功
if ($LASTEXITCODE -gt 7) { throw "robocopy failed with $LASTEXITCODE" }

# 2) 校验必需文件齐全
$required = @("manifest.json", "src\content.js", "src\detector.js", "src\background.js",
    "lib\marked.min.js", "lib\mermaid.min.js", "styles\viewer.css", "popup\popup.html",
    "workspace\workspace.html", "sample\workspace\manifest.json",
    "icons\icon16.png", "icons\icon48.png", "icons\icon128.png")
foreach ($f in $required) {
    if (-not (Test-Path (Join-Path $staging $f))) { throw "缺少必需文件: $f" }
}

# 3) 压缩（逐条目写入并强制使用 '/' 分隔符；Compress-Archive 在
#    Windows PowerShell 5.1 下会用 '\' 分隔，Chrome Web Store 会解析失败）
Add-Type -AssemblyName System.IO.Compression
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
if (Test-Path $zip) { Remove-Item -Force $zip }

$fileStream = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive($fileStream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($f in (Get-ChildItem -Path $staging -Recurse -File)) {
        $rel = $f.FullName.Substring($staging.Length + 1).Replace('\', '/')
        $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
        $input = $f.OpenRead()
        $output = $entry.Open()
        $input.CopyTo($output)
        $output.Close(); $input.Close()
    }
} finally {
    $archive.Dispose(); $fileStream.Dispose()
}
Remove-Item -Recurse -Force $staging

$size = "{0:N2} MB" -f ((Get-Item $zip).Length / 1MB)
Write-Output "OK: $zip ($size)"
