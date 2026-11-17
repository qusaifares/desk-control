# Read-only Windows display diagnostic for Desk Control.
# Run in Windows PowerShell (not from a company-managed computer).
# Repeat once with the PA279CV showing the PC and once showing the laptop.
param(
  [ValidateSet('pc', 'laptop', 'other')]
  [string]$Mode = 'other',
  [string]$OutDir = '.'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$path = Join-Path $OutDir "desk-topology-$Mode-$timestamp.json"
function Decode-EdidString([UInt16[]]$values) {
  if ($null -eq $values) { return '' }
  return (-join ($values | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ })).Trim()
}
$ids = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorID | ForEach-Object {
  [pscustomobject]@{
    instanceName = $_.InstanceName
    active = $_.Active
    manufacturer = Decode-EdidString $_.ManufacturerName
    model = Decode-EdidString $_.UserFriendlyName
    serial = Decode-EdidString $_.SerialNumberID
  }
})
$connections = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorConnectionParams | ForEach-Object {
  [pscustomobject]@{
    instanceName = $_.InstanceName
    active = $_.Active
    videoOutputTechnology = $_.VideoOutputTechnology
  }
})
$devices = @(Get-PnpDevice -Class Monitor | ForEach-Object {
  [pscustomobject]@{
    friendlyName = $_.FriendlyName
    instanceId = $_.InstanceId
    status = $_.Status
  }
})
$desktop = @(Get-CimInstance Win32_DesktopMonitor | ForEach-Object {
  [pscustomobject]@{
    name = $_.Name
    pnpDeviceId = $_.PNPDeviceID
    status = $_.Status
    screenWidth = $_.ScreenWidth
    screenHeight = $_.ScreenHeight
  }
})
[pscustomobject]@{
  capturedAt = (Get-Date).ToString('o')
  mode = $Mode
  computer = $env:COMPUTERNAME
  edidMonitors = $ids
  connections = $connections
  pnpMonitors = $devices
  desktopMonitors = $desktop
} | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -Path $path
Write-Host "Saved read-only monitor diagnostic to $path"
Write-Host 'Next: run the Desk Control agent probe in both input states and compare.'
Write-Host 'Note: WMI/PnP presence is not proof that Windows is actively extending its desktop.'
