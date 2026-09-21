$ErrorActionPreference = 'Stop'
$src = 'C:\meiad\Mineradio-paused-main\public'
$dst = 'C:\perry\client\public\visual'
New-Item -ItemType Directory -Force -Path $dst | Out-Null
New-Item -ItemType Directory -Force -Path "$dst\vendor","$dst\js\modules","$dst\assets","$dst\css" | Out-Null

Copy-Item "$src\vendor\three.r128.min.js" "$dst\vendor\" -Force
Copy-Item "$src\vendor\music-tempo.min.js" "$dst\vendor\" -Force
Copy-Item "$src\vendor\gsap.min.js" "$dst\vendor\" -Force
Copy-Item "$src\assets\skull-decimation-points.bin" "$dst\assets\" -Force
New-Item -ItemType Directory -Force -Path 'C:\perry\client\public\assets' | Out-Null
Copy-Item "$src\assets\skull-decimation-points.bin" 'C:\perry\client\public\assets\' -Force
Copy-Item "$src\sonic-topography-preset.js" "$dst\js\modules\" -Force
Copy-Item "$src\sonic-workshop-preset.js" "$dst\js\modules\" -Force
Copy-Item "$src\js\modules\11-main-loop.js" "$dst\js\modules\" -Force
Copy-Item "$src\js\modules\09-idle-toast-libraries.js" "$dst\js\modules\" -Force
Copy-Item "$src\js\modules\06-lyrics\00-lyrics-fetch-parse.js" "$dst\js\modules\06-lyrics\" -Force
Copy-Item "$src\js\modules\05-playback\08-audio-graph-controls.js" "$dst\js\modules\05-playback\" -Force
Copy-Item "$src\js\modules\05-playback\01-cover-custom-map.js" "$dst\js\modules\05-playback\" -Force
foreach ($dir in @('00-state','01-scene','02-visual','03-beat','07-fx')) {
  New-Item -ItemType Directory -Force -Path "$dst\js\modules\$dir" | Out-Null
  Copy-Item "$src\js\modules\$dir\*" "$dst\js\modules\$dir\" -Force -Recurse
}
Write-Host "visual restored files=$((Get-ChildItem $dst -Recurse -File).Count) bytes=$((Get-ChildItem $dst -Recurse -File | Measure-Object Length -Sum).Sum)"
