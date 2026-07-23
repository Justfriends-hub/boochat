$i=0
while ($i -lt 15) {
  try {
    $r = Invoke-WebRequest -Uri 'http://localhost:4173/explore/channel/channel-1' -UseBasicParsing -TimeoutSec 5
    Write-Output "CHANNEL: $($r.StatusCode)"
    break
  } catch {
    Start-Sleep -Seconds 1
  }
  $i++
}
$i=0
while ($i -lt 15) {
  try {
    $r = Invoke-WebRequest -Uri 'http://localhost:4173/explore/group/group-1' -UseBasicParsing -TimeoutSec 5
    Write-Output "GROUP: $($r.StatusCode)"
    break
  } catch {
    Start-Sleep -Seconds 1
  }
  $i++
}
