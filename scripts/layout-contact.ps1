Add-Type -AssemblyName System.Drawing
$taskRoot = (Get-Location).Path
$pictures = @(Get-ChildItem -LiteralPath (Join-Path $taskRoot 'docs/layout/after') -Filter '*.png' | Sort-Object Name)
$contactDir = Join-Path $taskRoot 'docs/layout/contact'
New-Item -ItemType Directory -Force -Path $contactDir | Out-Null
for ($start=0; $start -lt $pictures.Count; $start+=4) {
  $sheet=New-Object System.Drawing.Bitmap(1600,944)
  $g=[System.Drawing.Graphics]::FromImage($sheet)
  $g.Clear([System.Drawing.Color]::FromArgb(18,25,31))
  $font=New-Object System.Drawing.Font('Consolas',15)
  for ($j=0; $j -lt 4 -and ($start+$j) -lt $pictures.Count; $j++) {
    $file=$pictures[$start+$j]
    $picture=[System.Drawing.Image]::FromFile($file.FullName)
    $x=($j%2)*800; $y=[math]::Floor($j/2)*472
    $g.DrawImage($picture,$x,$y,800,450)
    $g.DrawString($file.Name,$font,[System.Drawing.Brushes]::White,$x+8,$y+450)
    $picture.Dispose()
  }
  $sheet.Save((Join-Path $contactDir ('sheet-'+[int]($start/4)+'.png')),[System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose();$font.Dispose();$sheet.Dispose()
}
