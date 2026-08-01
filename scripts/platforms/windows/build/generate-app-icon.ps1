# 生成 NiuMa 原创剑形图标 → PNG / ICO / favicon 资源
param(
    [string]$BrandDir = "$PSScriptRoot\..\..\..\..\assets\brand",
    [string]$ShellIco = "$PSScriptRoot\..\..\..\..\shell\resources\app.ico",
    [string]$WebPng = "$PSScriptRoot\..\..\..\..\web\public\app-icon-256.png",
    [string]$WebFavicon = "$PSScriptRoot\..\..\..\..\web\public\favicon.svg",
    # @niuma/ui 已迁至同级仓库 niuma-ui；未检出时跳过
    [string]$UiFavicon = "$PSScriptRoot\..\..\..\..\..\niuma-ui\playground\public\favicon.svg"
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

public static class NiuMaIconRenderer
{
    static readonly Color AuroraA = Color.FromArgb(255, 0x5a, 0xc8, 0xfa);
    static readonly Color AuroraB = Color.FromArgb(255, 0xbf, 0x5a, 0xf2);
    static readonly Color AuroraC = Color.FromArgb(255, 0xff, 0x37, 0x5f);
    static readonly Color AuroraD = Color.FromArgb(255, 0x64, 0xd2, 0xff);
    static readonly Color AuroraE = Color.FromArgb(255, 0x30, 0xd1, 0x58);
    static readonly Color IconWhite = Color.White;

    public static Bitmap Render(int size)
    {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);

            float pad = size * 0.0625f;
            float radius = size * 0.21875f;
            using (var bg = RoundedRect(pad, pad, size - pad * 2f, size - pad * 2f, radius))
            {
                using (var aurora = new LinearGradientBrush(
                    new PointF(pad - 2f, pad - 2f),
                    new PointF(size - pad + 2f, size - pad + 2f),
                    AuroraA, AuroraE))
                {
                    var cb = new ColorBlend(5);
                    cb.Colors = new Color[] { AuroraA, AuroraB, AuroraC, AuroraD, AuroraE };
                    cb.Positions = new float[] { 0f, 0.26f, 0.52f, 0.76f, 1f };
                    aurora.InterpolationColors = cb;
                    aurora.WrapMode = WrapMode.TileFlipXY;
                    g.FillPath(aurora, bg);
                }
                using (var gloss = new LinearGradientBrush(
                    new PointF(0f, pad - 2f),
                    new PointF(0f, size - pad + 2f),
                    Color.FromArgb(97, 255, 255, 255),
                    Color.FromArgb(26, 0, 0, 0)))
                {
                    var gb = new ColorBlend(3);
                    gb.Colors = new Color[] {
                        Color.FromArgb(97, 255, 255, 255),
                        Color.FromArgb(15, 255, 255, 255),
                        Color.FromArgb(26, 0, 0, 0)
                    };
                    gb.Positions = new float[] { 0f, 0.42f, 1f };
                    gloss.InterpolationColors = gb;
                    gloss.WrapMode = WrapMode.TileFlipXY;
                    g.FillPath(gloss, bg);
                }
            }

            float unit = size / 512f;
            using (var brush = new SolidBrush(IconWhite))
            {
                using (var blade = Blade(unit))
                    g.FillPath(brush, blade);
                using (var guard = Guard(unit))
                    g.FillPath(brush, guard);
                using (var grip = Grip(unit))
                    g.FillPath(brush, grip);
                using (var pommel = Pommel(unit))
                    g.FillPath(brush, pommel);
            }
        }
        return bmp;
    }

    static GraphicsPath RoundedRect(float x, float y, float w, float h, float r)
    {
        var path = new GraphicsPath();
        float d = r * 2f;
        path.AddArc(x, y, d, d, 180, 90);
        path.AddArc(x + w - d, y, d, d, 270, 90);
        path.AddArc(x + w - d, y + h - d, d, d, 0, 90);
        path.AddArc(x, y + h - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    static GraphicsPath Blade(float u)
    {
        var p = new GraphicsPath();
        p.AddPolygon(new PointF[] {
            new PointF(256*u, 96*u), new PointF(286*u, 292*u), new PointF(272*u, 292*u),
            new PointF(256*u, 268*u), new PointF(240*u, 292*u), new PointF(226*u, 292*u)
        });
        return p;
    }

    static GraphicsPath Guard(float u)
    {
        var p = new GraphicsPath();
        p.AddRectangle(new RectangleF(188*u, 292*u, 136*u, 36*u));
        return p;
    }

    static GraphicsPath Grip(float u)
    {
        var p = new GraphicsPath();
        p.AddRectangle(new RectangleF(236*u, 328*u, 40*u, 72*u));
        return p;
    }

    static GraphicsPath Pommel(float u)
    {
        var p = new GraphicsPath();
        float x = 224*u, y = 400*u, w = 64*u, h = 20*u, r = 10*u;
        p.AddArc(x, y, r * 2f, h, 90, 180);
        p.AddArc(x + w - r * 2f, y, r * 2f, h, 270, 180);
        p.CloseFigure();
        return p;
    }
}
"@

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$path) {
    $dir = Split-Path $path -Parent
    if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function New-SquareIcon([int]$size) {
    return [NiuMaIconRenderer]::Render($size)
}

if (-not (Test-Path $BrandDir)) {
    New-Item -ItemType Directory -Force -Path $BrandDir | Out-Null
}
$BrandDir = (Resolve-Path $BrandDir).Path
$icoDir = Split-Path $ShellIco -Parent
New-Item -ItemType Directory -Force -Path $BrandDir, $icoDir | Out-Null

$master = New-SquareIcon 512
Save-Png $master (Join-Path $BrandDir 'app-icon-512.png')
$master.Dispose()

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$fs = [System.IO.File]::Open($ShellIco, [System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter($fs)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$sizes.Count)
$offset = 6 + (16 * $sizes.Count)
$pngDataList = New-Object System.Collections.Generic.List[byte[]]

foreach ($s in $sizes) {
    $bmp = New-SquareIcon $s
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngData = $ms.ToArray()
    [void]$pngDataList.Add($pngData)
    $bmp.Dispose()
    $ms.Dispose()
    $writer.Write([Byte]($s -band 0xFF))
    $writer.Write([Byte](($s -shr 8) -band 0xFF))
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([Byte]1)
    $writer.Write([Byte]0)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$pngData.Length)
    $writer.Write([UInt32]$offset)
    $offset += $pngData.Length
}

for ($i = 0; $i -lt $sizes.Count; $i++) {
    $writer.Write($pngDataList[$i])
}

$writer.Close()
$fs.Close()

foreach ($s in @(16, 32, 48, 256)) {
    $bmp = New-SquareIcon $s
    Save-Png $bmp (Join-Path $BrandDir "app-icon-$s.png")
    $bmp.Dispose()
}

Copy-Item $ShellIco (Join-Path $BrandDir 'app-icon.ico') -Force
Copy-Item (Join-Path $BrandDir 'app-icon-256.png') $WebPng -Force

$smallSvg = @'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <defs>
    <linearGradient id="nmAurora" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5ac8fa" />
      <stop offset="0.26" stop-color="#bf5af2" />
      <stop offset="0.52" stop-color="#ff375f" />
      <stop offset="0.76" stop-color="#64d2ff" />
      <stop offset="1" stop-color="#30d158" />
    </linearGradient>
    <linearGradient id="nmGloss" x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.38" />
      <stop offset="0.42" stop-color="#ffffff" stop-opacity="0.06" />
      <stop offset="1" stop-color="#000000" stop-opacity="0.10" />
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="7" fill="url(#nmAurora)"/>
  <rect width="32" height="32" rx="7" fill="url(#nmGloss)"/>
  <g fill="#fff">
    <path d="M16 6 L17.9 18.2 L17 18.2 L16 16.8 L15 18.2 L14.1 18.2 Z"/>
    <path d="M11.8 18.2 H20.2 V20.5 H11.8 Z"/>
    <path d="M14.8 20.5 H17.2 V25 H14.8 Z"/>
    <rect x="14" y="25" width="4" height="1.25" rx="0.6"/>
  </g>
</svg>
'@
Set-Content -Path $WebFavicon -Value $smallSvg -Encoding UTF8

$uiFaviconDir = Split-Path -Parent $UiFavicon
if (Test-Path $uiFaviconDir) {
    Set-Content -Path $UiFavicon -Value $smallSvg -Encoding UTF8
    Write-Host "Updated UI playground favicon: $UiFavicon"
} else {
    Write-Host "Skip UI favicon (directory missing): $uiFaviconDir"
}

$RcPath = Join-Path (Split-Path $ShellIco) 'niuma.rc'
if (Test-Path $RcPath) {
    (Get-Item $RcPath).LastWriteTime = Get-Date
}

Write-Host "Generated sword icon: $ShellIco"
Write-Host "Updated: $WebPng, $WebFavicon"
