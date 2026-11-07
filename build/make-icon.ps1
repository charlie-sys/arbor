Add-Type -AssemblyName System.Drawing
$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 210
$d = $r * 2
$path.AddArc(0, 0, $d, $d, 180, 90)
$path.AddArc($size - $d, 0, $d, $d, 270, 90)
$path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
$path.AddArc(0, $size - $d, $d, $d, 90, 90)
$path.CloseFigure()
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point(0, 0)), (New-Object System.Drawing.Point($size, $size)), [System.Drawing.Color]::FromArgb(255, 23, 30, 43), [System.Drawing.Color]::FromArgb(255, 12, 18, 28))
$g.FillPath($bg, $path)
$font = New-Object System.Drawing.Font('Segoe UI Black', 600, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fg = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point(230, 200)), (New-Object System.Drawing.Point(820, 840)), [System.Drawing.Color]::FromArgb(255, 79, 140, 255), [System.Drawing.Color]::FromArgb(255, 34, 211, 238))
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0, 20, $size, $size)
$g.DrawString('Z', $font, $fg, $rect, $fmt)
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 79, 140, 255), 14)
$g.DrawLine($pen, 300, 812, 724, 812)
$bmp.Save((Join-Path (Get-Location) 'build/icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output 'icon written'
