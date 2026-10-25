Add-Type -AssemblyName System.Drawing

# Draws the logo, a golden star inside a laurel wreath on a night-blue tile, on a 256-unit grid. The PNG is the app's
# icon in the page, the ICO is for the Windows executable.
$web = Join-Path $PSScriptRoot '..\app'
$out = Join-Path $PSScriptRoot '..\shell'

function P([float]$x, [float]$y) { New-Object Drawing.PointF $x, $y }
function Rgb([string]$hex) { [Drawing.ColorTranslator]::FromHtml($hex) }

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, 2 * $r, 2 * $r, 180, 90)
    $path.AddArc($x + $w - 2 * $r, $y, 2 * $r, 2 * $r, 270, 90)
    $path.AddArc($x + $w - 2 * $r, $y + $h - 2 * $r, 2 * $r, 2 * $r, 0, 90)
    $path.AddArc($x, $y + $h - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-Star([float]$cx, [float]$cy, [float]$outer, [float]$inner) {
    $points = for ($i = 0; $i -lt 10; $i++) {
        $r = if ($i % 2 -eq 0) { $outer } else { $inner }
        $a = [math]::PI * (-90 + 36 * $i) / 180
        P ($cx + $r * [math]::Cos($a)) ($cy + $r * [math]::Sin($a))
    }
    $path = New-Object Drawing.Drawing2D.GraphicsPath
    $path.AddPolygon([Drawing.PointF[]]$points)
    return $path
}

function New-Logo([int]$size) {
    $bmp = New-Object Drawing.Bitmap $size, $size
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([Drawing.Color]::Transparent)
    $g.ScaleTransform($size / 256, $size / 256)

    $night = New-Object Drawing.Drawing2D.LinearGradientBrush (P 0 0), (P 256 256), (Rgb '#24375F'), (Rgb '#0B1222')
    $g.FillPath($night, (New-RoundedRect 0 0 256 256 58))

    $gold = New-Object Drawing.Drawing2D.LinearGradientBrush (P 0 40), (P 0 220), (Rgb '#FFE7A3'), (Rgb '#C98F2A')

    # Two branches of leaves along a circle, from the bottom up both sides, open at the top.
    foreach ($side in -1, 1) {
        for ($i = 0; $i -lt 7; $i++) {
            $deg = 112 + 19 * $i
            if ($side -eq 1) { $deg = 180 - $deg }
            $a = [math]::PI * $deg / 180
            $state = $g.Save()
            $g.TranslateTransform([float](128 + 86 * [math]::Cos($a)), [float](134 + 86 * [math]::Sin($a)))
            $g.RotateTransform([float]($deg + $side * 28))
            $leaf = New-Object Drawing.Drawing2D.GraphicsPath
            $leaf.AddEllipse(-9, -20, 18, 40)
            $g.FillPath($gold, $leaf)
            $g.Restore($state)
        }
    }

    $g.FillPath($gold, (New-Star 128 120 54 22))
    $g.Dispose()
    return $bmp
}

# Windows renders small icons more reliably from classic DIB frames than PNG ones.
function ConvertTo-Dib($bmp) {
    $w = $bmp.Width; $h = $bmp.Height
    $ms = New-Object IO.MemoryStream
    $bw = New-Object IO.BinaryWriter $ms
    $bw.Write([uint32]40); $bw.Write([int32]$w); $bw.Write([int32]($h * 2))
    $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]0)
    $bw.Write([uint32]($w * $h * 4))
    $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)

    for ($y = $h - 1; $y -ge 0; $y--) {
        for ($x = 0; $x -lt $w; $x++) {
            $c = $bmp.GetPixel($x, $y)
            $bw.Write([byte]$c.B); $bw.Write([byte]$c.G)
            $bw.Write([byte]$c.R); $bw.Write([byte]$c.A)
        }
    }

    $stride = [math]::Floor(($w + 31) / 32) * 4
    $bw.Write((New-Object byte[] ($stride * $h)))
    $bw.Flush()
    return $ms.ToArray()
}

function ConvertTo-Png($bmp) {
    $ms = New-Object IO.MemoryStream
    $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
    return $ms.ToArray()
}

$png = New-Logo 256
$png.Save((Join-Path $web 'icon.png'), [Drawing.Imaging.ImageFormat]::Png)
$png.Dispose()

$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
$frames = foreach ($s in $sizes) {
    $bmp = New-Logo $s
    $data = if ($s -ge 128) { ConvertTo-Png $bmp } else { ConvertTo-Dib $bmp }
    $bmp.Dispose()
    , $data
}

$ico = New-Object IO.MemoryStream
$w = New-Object IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$frames.Count)
$offset = 6 + (16 * $frames.Count)
for ($i = 0; $i -lt $frames.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$frames[$i].Length); $w.Write([uint32]$offset)
    $offset += $frames[$i].Length
}
foreach ($frame in $frames) { $ico.Write($frame, 0, $frame.Length) }
$w.Flush()
[IO.File]::WriteAllBytes((Join-Path $out 'icon.ico'), $ico.ToArray())
$w.Dispose()

# The website's link preview (og:image in index.html), also the repository's social preview: the logo, the name, what it
# does, and a row of the game's culture badges from the art pack.
function New-Social {
    $width = 1280; $height = 640
    $bmp = New-Object Drawing.Bitmap $width, $height
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $g.FillRectangle((New-Object Drawing.Drawing2D.LinearGradientBrush (P 0 0), (P $width $height), (Rgb '#1B2B4D'), (Rgb '#0A101E')), 0, 0, $width, $height)
    $halo = New-Object Drawing.Drawing2D.GraphicsPath
    $halo.AddEllipse(30, 110, 420, 420)
    $glow = New-Object Drawing.Drawing2D.PathGradientBrush $halo
    $glow.CenterColor = [Drawing.Color]::FromArgb(90, 226, 184, 92)
    $glow.SurroundColors = [Drawing.Color[]]@([Drawing.Color]::FromArgb(0, 226, 184, 92))
    $g.FillPath($glow, $halo)
    $logo = New-Logo 280
    $g.DrawImage($logo, 100, 180, 280, 280)
    $logo.Dispose()

    $px = [Drawing.GraphicsUnit]::Pixel
    $ink = New-Object Drawing.SolidBrush (Rgb '#ECE7DA')
    $muted = New-Object Drawing.SolidBrush (Rgb '#9AA5BD')
    $gold = New-Object Drawing.SolidBrush (Rgb '#E2B85C')
    $g.DrawString('AoM Retold Tracker', (New-Object Drawing.Font 'Segoe UI Semibold', 66, ([Drawing.FontStyle]::Regular), $px), $ink, 452, 104)
    $g.DrawString("Every achievement and badge of`nAge of Mythology: Retold, and your progress.",
        (New-Object Drawing.Font 'Segoe UI', 31, ([Drawing.FontStyle]::Regular), $px), $muted, (New-Object Drawing.RectangleF 456, 200, 760, 90))

    $index = Get-Content (Join-Path $web 'art\badges.json') -Raw | ConvertFrom-Json
    $pack = [IO.File]::ReadAllBytes((Join-Path $web 'art\badges.pack'))
    $x = 452
    foreach ($name in 'conqueror_of_olympus', 'ruler_of_the_nile', 'champion_of_valhalla', 'champion_of_atlantis', 'jade_emperor', 'daimyo') {
        $at = $index.at.$name
        $badge = [Drawing.Image]::FromStream((New-Object IO.MemoryStream (, $pack[$at[0]..($at[0] + $at[1] - 1)])))
        $g.DrawImage($badge, $x, 312, 112, 112)
        $badge.Dispose()
        $x += 124
    }

    $g.FillRectangle($gold, 456, 470, 64, 4)
    $g.DrawString('Steam  ·  Xbox  ·  PlayStation  ·  Website and desktop app', (New-Object Drawing.Font 'Segoe UI Semibold', 26, ([Drawing.FontStyle]::Regular), $px), $ink, 452, 494)
    $g.DrawString('xxseryixx.github.io/aomr-tracker', (New-Object Drawing.Font 'Segoe UI', 24, ([Drawing.FontStyle]::Regular), $px), $gold, 452, 540)
    $g.Dispose()
    return $bmp
}

$social = New-Social
$social.Save((Join-Path $web 'social.png'), [Drawing.Imaging.ImageFormat]::Png)
$social.Dispose()

'icon.ico written to shell/, icon.png and social.png written to app/'
