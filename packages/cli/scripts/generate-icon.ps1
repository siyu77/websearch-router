# Generates the Windows tray icon: teal rounded-square + white "WR" letter mark,
# as a multi-size (16/24/32/48) DIB-based .ico. Pure System.Drawing, no ImageMagick.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File generate-icon.ps1 [-OutPath packages/cli/src/tray/icon.ico]
# Output: a 4-frame ICO (16/24/32/48, 32bpp BGRA, DIB frames) + self-check printout.
#
# NOTE: frames are DIB (BITMAPINFOHEADER + bottom-up BGRA + AND mask), NOT PNG-embedded.
# System.Drawing.Icon loads DIB frames reliably (verified: ctor, ToBitmap, NotifyIcon.Icon);
# PNG-embedded frames load but ToBitmap/rendering can fail on some paths.
param([string]$OutPath = "")

Add-Type -AssemblyName System.Drawing

$teal  = [System.Drawing.Color]::FromArgb(255, 13, 148, 136)   # #0D9488
$white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
$Sizes = @(16, 24, 32, 48)

if (-not $OutPath) {
  $OutPath = Join-Path $PSScriptRoot (Join-Path '..' 'src\tray\icon.ico')
}
$OutPath = [System.IO.Path]::GetFullPath($OutPath)

# Draw the teal WR badge at a given logical pixel size S, return Bitmap (32bppArgb).
function New-WrBadge($S) {
  $bmp = New-Object System.Drawing.Bitmap($S, $S)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  # rounded-square badge, slightly inset
  $r = [Math]::Max(2.0, $S * 0.18)
  $rect = New-Object System.Drawing.Rectangle(($S*0.04), ($S*0.04), ($S*0.92), ($S*0.92))
  $gp = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $gp.AddArc($rect.X, $rect.Y, $r*2, $r*2, 180, 90)
  $gp.AddArc(($rect.Right-$r*2), $rect.Y, $r*2, $r*2, 270, 90)
  $gp.AddArc(($rect.Right-$r*2), ($rect.Bottom-$r*2), $r*2, $r*2, 0, 90)
  $gp.AddArc($rect.X, ($rect.Bottom-$r*2), $r*2, $r*2, 90, 90)
  $gp.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush($teal)), $gp)

  # "WR" centered, white, bold. Size font to fit ~85% of badge width (bigger than before).
  $fam = New-Object System.Drawing.FontFamily("Arial")
  $targetW = $S * 0.85
  $fs = [Math]::Max(8.0, $S * 0.65)
  $font = New-Object System.Drawing.Font($fam, $fs, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $try = 0
  while ($try -lt 40) {
    $sz = $g.MeasureString("WR", $font)
    if ($sz.Width -le $targetW) { break }
    $fs -= 0.5
    if ($fs -lt 6) { break }
    $font.Dispose()
    $font = New-Object System.Drawing.Font($fam, $fs, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $try++
  }
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString("WR", $font, (New-Object System.Drawing.SolidBrush($white)), (New-Object System.Drawing.RectangleF(0, 0, $S, $S)), $sf)
  $font.Dispose(); $g.Dispose()
  return $bmp
}

# Write a DIB-based ICO containing one frame per bitmap in $bmps.
function New-DibIco([System.Drawing.Bitmap[]]$bmps, $icoPath) {
  $count = $bmps.Count
  $fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
  $bw = New-Object System.IO.BinaryWriter($fs)
  # ICONDIR: reserved(0), type(1=icon), count
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$count)

  # pre-scan to compute offsets
  $entries = @()
  $offset = 6 + (16 * $count)
  foreach ($b in $bmps) {
    $w = $b.Width; $h = $b.Height
    $sizeImage = ($w * $h * 4)                                   # BGRA pixels
    $andStride = [Math]::Ceiling($w / 8 / 4) * 4                  # AND-mask row stride (4-align)
    $andSize = $andStride * $h
    $bytesInRes = 40 + $sizeImage + $andSize
    $bw.Write([Byte]($(if ($w -ge 256) { 0 } else { $w })))       # ICONDIRENTRY width (0 = 256)
    $bw.Write([Byte]($(if ($h -ge 256) { 0 } else { $h })))
    $bw.Write([Byte]0); $bw.Write([Byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)                    # planes=1, bpp=32
    $bw.Write([UInt32]$bytesInRes)
    $bw.Write([UInt32]$offset)
    $entries += @{ bmp = $b; sizeImage = $sizeImage; andStride = $andStride; andSize = $andSize }
    $offset += $bytesInRes
  }

  foreach ($e in $entries) {
    $b = $e.bmp; $w = $b.Width; $h = $b.Height
    # BITMAPINFOHEADER
    $bw.Write([UInt32]40)
    $bw.Write([Int32]$w); $bw.Write([Int32]($h * 2))               # height = XOR+AND rows
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]0)                                            # BI_RGB (no compression)
    $bw.Write([UInt32]$e.sizeImage)
    $bw.Write([Int32]0); $bw.Write([Int32]0)                        # xppm/ypmm
    $bw.Write([UInt32]0); $bw.Write([UInt32]0)                      # used / important

    # BGRA pixels, bottom-up
    $data = $b.LockBits((New-Object System.Drawing.Rectangle(0, 0, $w, $h)),
      [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride
    $rowBytes = $w * 4
    $buf = New-Object byte[] ($h * $stride)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)
    $b.UnlockBits($data)
    for ($y = $h - 1; $y -ge 0; $y--) { $bw.Write($buf, ($y * $stride), $rowBytes) }

    # AND mask (all zeros => fully opaque use of alpha channel)
    $bw.Write([byte[]]::new($e.andSize))
  }
  $bw.Close(); $fs.Close()
}

# ---- generate ----
$frames = @()
foreach ($s in $Sizes) { $frames += New-WrBadge $s }
$dir = Split-Path $OutPath -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
New-DibIco $frames $OutPath
foreach ($f in $frames) { $f.Dispose() }

# ---- self-check ----
$bytes = [System.IO.File]::ReadAllBytes($OutPath)
$count = [BitConverter]::ToUInt16($bytes, 4)
Write-Output "WROTE $OutPath"
Write-Output "ICO frames = $count"
for ($i = 0; $i -lt $count; $i++) {
  $off = 6 + ($i * 16)
  $w = $bytes[$off]; $h = $bytes[$off + 1]
  $planes = [BitConverter]::ToUInt16($bytes, $off + 4)
  $bpp = [BitConverter]::ToUInt16($bytes, $off + 6)
  Write-Output ("  frame {0}: {1}x{2} planes={3} bpp={4}" -f $i, $w, $h, $planes, $bpp)
}

# ---- verify loadability via System.Drawing.Icon ----
try {
  $ico = New-Object System.Drawing.Icon($OutPath)
  $bmp = $ico.ToBitmap()
  Write-Output ("LOAD OK: {0}x{1}, {2}, corner={3}" -f $bmp.Width, $bmp.Height, $bmp.PixelFormat, $bmp.GetPixel(0, 0))
  $bmp.Dispose(); $ico.Dispose()
} catch {
  Write-Output "LOAD FAILED: $($_.Exception.Message)"
}
