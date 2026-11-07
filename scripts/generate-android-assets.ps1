Add-Type -AssemblyName System.Drawing

$srcIconPath = "c:\Users\User\Desktop\paperless\client\public\icons\icon-512.png"
if (-not (Test-Path $srcIconPath)) {
    Write-Error "Source icon not found at $srcIconPath"
    exit 1
}

$srcImg = [System.Drawing.Bitmap]::FromFile($srcIconPath)
$baseRes = "c:\Users\User\Desktop\paperless\android\app\src\main\res"

# 1. Launcher Icons
$iconSizes = @{
    "mipmap-mdpi"    = @{ size = 48;  fg = 108 }
    "mipmap-hdpi"    = @{ size = 72;  fg = 162 }
    "mipmap-xhdpi"   = @{ size = 96;  fg = 216 }
    "mipmap-xxhdpi"  = @{ size = 144; fg = 324 }
    "mipmap-xxxhdpi" = @{ size = 192; fg = 432 }
}

foreach ($folder in $iconSizes.Keys) {
    $info = $iconSizes[$folder]
    $size = $info.size
    $fgSize = $info.fg
    $targetDir = Join-Path $baseRes $folder

    # A. Standard ic_launcher.png
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($srcImg, 0, 0, $size, $size)
    $g.Dispose()
    $bmp.Save((Join-Path $targetDir "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    # B. Circular ic_launcher_round.png
    $bmpRound = New-Object System.Drawing.Bitmap($size, $size)
    $gRound = [System.Drawing.Graphics]::FromImage($bmpRound)
    $gRound.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gRound.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $gRound.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gRound.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(0, 0, $size, $size)
    $gRound.SetClip($path)
    $gRound.DrawImage($srcImg, 0, 0, $size, $size)
    $path.Dispose()
    $gRound.Dispose()
    $bmpRound.Save((Join-Path $targetDir "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpRound.Dispose()

    # C. Adaptive Foreground ic_launcher_foreground.png
    $bmpFg = New-Object System.Drawing.Bitmap($fgSize, $fgSize)
    $gFg = [System.Drawing.Graphics]::FromImage($bmpFg)
    $gFg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gFg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $gFg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gFg.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    # Safe zone is 66% centered
    $contentSize = [int]($fgSize * 0.65)
    $offset = [int](($fgSize - $contentSize) / 2)
    $gFg.DrawImage($srcImg, $offset, $offset, $contentSize, $contentSize)
    $gFg.Dispose()
    $bmpFg.Save((Join-Path $targetDir "ic_launcher_foreground.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpFg.Dispose()

    Write-Output "Generated icons for $folder ($size x $size, fg: $fgSize x $fgSize)"
}

# 2. Splash Screens
$splashSizes = @{
    "drawable"               = @{ w = 480;  h = 320 }
    "drawable-land-mdpi"     = @{ w = 480;  h = 320 }
    "drawable-land-hdpi"     = @{ w = 800;  h = 480 }
    "drawable-land-xhdpi"    = @{ w = 1280; h = 720 }
    "drawable-land-xxhdpi"   = @{ w = 1600; h = 960 }
    "drawable-land-xxxhdpi"  = @{ w = 1920; h = 1280 }
    "drawable-port-mdpi"     = @{ w = 320;  h = 480 }
    "drawable-port-hdpi"     = @{ w = 480;  h = 800 }
    "drawable-port-xhdpi"    = @{ w = 720;  h = 1280 }
    "drawable-port-xxhdpi"   = @{ w = 960;  h = 1600 }
    "drawable-port-xxxhdpi"  = @{ w = 1280; h = 1920 }
}

$bgColor = [System.Drawing.ColorTranslator]::FromHtml("#17191C")

foreach ($folder in $splashSizes.Keys) {
    $dim = $splashSizes[$folder]
    $w = $dim.w
    $h = $dim.h
    $targetDir = Join-Path $baseRes $folder

    $bmpSplash = New-Object System.Drawing.Bitmap($w, $h)
    $gSplash = [System.Drawing.Graphics]::FromImage($bmpSplash)
    $gSplash.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gSplash.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $gSplash.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gSplash.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    # Dark slate background #17191C
    $brush = New-Object System.Drawing.SolidBrush($bgColor)
    $gSplash.FillRectangle($brush, 0, 0, $w, $h)
    $brush.Dispose()

    # Center Paperless icon
    $minDim = [Math]::Min($w, $h)
    $iconScale = [Math]::Max(72, [int]($minDim * 0.28))
    $iconX = [int](($w - $iconScale) / 2)
    $iconY = [int](($h - $iconScale) / 2)

    $gSplash.DrawImage($srcImg, $iconX, $iconY, $iconScale, $iconScale)
    $gSplash.Dispose()

    $bmpSplash.Save((Join-Path $targetDir "splash.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpSplash.Dispose()

    Write-Output "Generated splash for $folder ($w x $h, icon: $iconScale x $iconScale)"
}

$srcImg.Dispose()
Write-Output "All Android icons and splash screens successfully generated!"
