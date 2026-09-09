/**
 * The Windows DDC/CI bridge, embedded as a string.
 *
 * Why a PowerShell host process rather than an FFI binding:
 *
 *  - No native module. The agent installs and runs on a fresh Windows machine
 *    with nothing but Node - no compiler, no prebuilt binary per Node ABI, and
 *    no separate story for ARM64.
 *  - It works identically when the agent runs natively on Windows and when it
 *    runs under WSL, because powershell.exe is reachable from both. That is how
 *    this provider was developed and verified against real monitors.
 *  - It is one long-lived process, not one per call: the P/Invoke type is
 *    compiled once at startup, after which each operation is a JSON line in and
 *    a JSON line out, costing milliseconds.
 *
 * Why embedded rather than shipped as a .ps1 file: it removes path resolution
 * from a bundled build entirely. The Node side writes it to a temp file once
 * per process.
 *
 * String.raw keeps backslashes literal - PowerShell needs them (root\wmi) and a
 * normal template literal would silently eat them.
 *
 * Protocol, one JSON object per line in each direction:
 *   -> {"id":"1","op":"list"}
 *   -> {"id":"2","op":"observe"}
 *   -> {"id":"3","op":"getvcp","deviceId":"\\?\DISPLAY#...","code":96}
 *   -> {"id":"4","op":"setvcp","deviceId":"\\?\DISPLAY#...","code":96,"value":15}
 *   -> {"id":"5","op":"ping"}
 *   <- {"id":"1","ok":true,"result":{...}}
 *   <- {"id":"3","ok":false,"error":{"code":"DEVICE_UNREACHABLE","message":"..."}}
 *
 * Handles are never held across operations. Physical monitor handles are
 * invalidated by display topology changes, so every operation re-enumerates and
 * looks the monitor up by its stable device interface path.
 */
export const DDC_BRIDGE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class DeskDdc {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct PHYSICAL_MONITOR {
    public IntPtr hPhysicalMonitor;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szDescription;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFOEX {
    public int cbSize;
    public int rcMonitorLeft, rcMonitorTop, rcMonitorRight, rcMonitorBottom;
    public int rcWorkLeft, rcWorkTop, rcWorkRight, rcWorkBottom;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
    public uint StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
  }

  public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, IntPtr lprc, IntPtr data);

  [DllImport("user32.dll")]
  public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool GetMonitorInfoW(IntPtr hMonitor, ref MONITORINFOEX info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool EnumDisplayDevicesW(string device, uint devNum, ref DISPLAY_DEVICE dd, uint flags);

  [DllImport("dxva2.dll", SetLastError = true)]
  public static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr h, ref uint count);
  [DllImport("dxva2.dll", SetLastError = true)]
  public static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr h, uint count, [Out] PHYSICAL_MONITOR[] arr);
  [DllImport("dxva2.dll", SetLastError = true)]
  public static extern bool DestroyPhysicalMonitors(uint count, [In] PHYSICAL_MONITOR[] arr);
  [DllImport("dxva2.dll", SetLastError = true)]
  public static extern bool GetCapabilitiesStringLength(IntPtr h, ref uint len);
  [DllImport("dxva2.dll", SetLastError = true)]
  public static extern bool CapabilitiesRequestAndCapabilitiesReply(IntPtr h, StringBuilder buf, uint len);
  [DllImport("dxva2.dll", SetLastError = true)]
  public static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr h, byte code, out uint type, out uint current, out uint max);
  [DllImport("dxva2.dll", SetLastError = true)]
  public static extern bool SetVCPFeature(IntPtr h, byte code, uint value);

  public static List<IntPtr> Handles() {
    var list = new List<IntPtr>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr h, IntPtr hdc, IntPtr r, IntPtr d) {
      list.Add(h); return true;
    }, IntPtr.Zero);
    return list;
  }
}
'@ | Out-Null

function Get-Displays {
  $displays = @()
  foreach ($h in [DeskDdc]::Handles()) {
    $mi = New-Object DeskDdc+MONITORINFOEX
    $mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mi)
    if (-not [DeskDdc]::GetMonitorInfoW($h, [ref]$mi)) { continue }

    $count = [uint32]0
    if (-not [DeskDdc]::GetNumberOfPhysicalMonitorsFromHMONITOR($h, [ref]$count)) { continue }
    if ($count -eq 0) { continue }

    $index = [uint32]0
    while ($index -lt $count) {
      $dd = New-Object DeskDdc+DISPLAY_DEVICE
      $dd.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($dd)
      $deviceId = $null
      $deviceString = $null
      if ([DeskDdc]::EnumDisplayDevicesW($mi.szDevice, $index, [ref]$dd, 1)) {
        $deviceId = $dd.DeviceID
        $deviceString = $dd.DeviceString
      }
      $displays += [pscustomobject]@{
        Handle       = $h
        Adapter      = $mi.szDevice
        Index        = $index
        Count        = $count
        DeviceId     = $deviceId
        DeviceString = $deviceString
        IsPrimary    = ($mi.dwFlags -band 1) -eq 1
      }
      $index = $index + 1
    }
  }
  return $displays
}

function Use-PhysicalMonitor {
  param($Display, [scriptblock]$Action)

  $arr = New-Object DeskDdc+PHYSICAL_MONITOR[] $Display.Count
  if (-not [DeskDdc]::GetPhysicalMonitorsFromHMONITOR($Display.Handle, $Display.Count, $arr)) {
    throw 'GetPhysicalMonitorsFromHMONITOR failed (' + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error() + ')'
  }
  try {
    return & $Action $arr[$Display.Index]
  } finally {
    [void][DeskDdc]::DestroyPhysicalMonitors($Display.Count, $arr)
  }
}

function Get-EdidBlocks {
  # Raw EDID straight from the device registry key. The Node side parses it,
  # so identity is computed by one tested implementation on every platform
  # rather than by whatever each OS chooses to surface.
  $blocks = @()
  try {
    $root = 'HKLM:\SYSTEM\CurrentControlSet\Enum\DISPLAY'
    $params = Get-ChildItem -Path $root -Recurse -Depth 2 -ErrorAction SilentlyContinue |
      Where-Object { $_.PSChildName -eq 'Device Parameters' }
    foreach ($entry in $params) {
      $edid = (Get-ItemProperty -Path $entry.PSPath -Name EDID -ErrorAction SilentlyContinue).EDID
      if ($null -eq $edid) { continue }
      $key = $entry.Name -replace '^.*?\\Enum\\', '' -replace '\\Device Parameters$', ''
      $hex = -join ($edid | ForEach-Object { $_.ToString('x2') })
      $blocks += [pscustomobject]@{ key = $key; edidHex = $hex }
    }
  } catch {
    # Without EDID the Node side falls back to the DDC-reported model and marks
    # the identity weak, which is better than failing discovery outright.
  }
  return $blocks
}

function Find-Display {
  param([string]$DeviceId)
  foreach ($d in (Get-Displays)) {
    if ($d.DeviceId -eq $DeviceId) { return $d }
  }
  throw 'No display matches device id ' + $DeviceId
}

function Read-Vcp {
  param($Display, [byte]$Code)
  return Use-PhysicalMonitor -Display $Display -Action {
    param($pm)
    $type = [uint32]0; $current = [uint32]0; $max = [uint32]0
    if (-not [DeskDdc]::GetVCPFeatureAndVCPFeatureReply($pm.hPhysicalMonitor, $Code, [ref]$type, [ref]$current, [ref]$max)) {
      throw 'GetVCPFeatureAndVCPFeatureReply failed (' + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error() + ')'
    }
    return [pscustomobject]@{ value = [int]$current; max = [int]$max; type = [int]$type }
  }
}

function Invoke-List {
  $edid = Get-EdidBlocks
  $monitors = @()
  foreach ($d in (Get-Displays)) {
    $caps = $null
    $capsError = $null
    try {
      $caps = Use-PhysicalMonitor -Display $d -Action {
        param($pm)
        $len = [uint32]0
        if (-not [DeskDdc]::GetCapabilitiesStringLength($pm.hPhysicalMonitor, [ref]$len)) {
          throw 'GetCapabilitiesStringLength failed (' + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error() + ')'
        }
        if ($len -eq 0) { throw 'Monitor reported an empty capabilities string' }
        $sb = New-Object System.Text.StringBuilder ([int]$len)
        if (-not [DeskDdc]::CapabilitiesRequestAndCapabilitiesReply($pm.hPhysicalMonitor, $sb, $len)) {
          throw 'CapabilitiesRequestAndCapabilitiesReply failed (' + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error() + ')'
        }
        return $sb.ToString()
      }
    } catch {
      $capsError = $_.Exception.Message
    }

    $monitors += [pscustomobject]@{
      deviceId              = $d.DeviceId
      description           = $d.DeviceString
      capabilities          = $caps
      capabilitiesError     = $capsError
      fallbackDisambiguator = $d.Adapter
    }
  }
  return [pscustomobject]@{ monitors = @($monitors); edid = @($edid) }
}

function Invoke-Observe {
  $results = @()
  foreach ($d in (Get-Displays)) {
    try {
      $vcp = Read-Vcp -Display $d -Code 0x60
      $results += [pscustomobject]@{ deviceId = $d.DeviceId; ok = $true; value = $vcp.value; error = $null }
    } catch {
      $results += [pscustomobject]@{ deviceId = $d.DeviceId; ok = $false; value = $null; error = $_.Exception.Message }
    }
  }
  return [pscustomobject]@{ monitors = @($results) }
}

function Write-Response {
  param($Payload)
  [Console]::Out.WriteLine(($Payload | ConvertTo-Json -Depth 8 -Compress))
  [Console]::Out.Flush()
}

Write-Response ([pscustomobject]@{ id = 'ready'; ok = $true; result = [pscustomobject]@{ ready = $true } })

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }

  $id = 'unknown'
  try {
    $request = $line | ConvertFrom-Json
    $id = $request.id
    switch ($request.op) {
      'ping'    { Write-Response ([pscustomobject]@{ id = $id; ok = $true; result = [pscustomobject]@{ pong = $true } }) }
      'list'    { Write-Response ([pscustomobject]@{ id = $id; ok = $true; result = (Invoke-List) }) }
      'observe' { Write-Response ([pscustomobject]@{ id = $id; ok = $true; result = (Invoke-Observe) }) }
      'getvcp'  {
        $display = Find-Display -DeviceId $request.deviceId
        $vcp = Read-Vcp -Display $display -Code ([byte]$request.code)
        Write-Response ([pscustomobject]@{ id = $id; ok = $true; result = $vcp })
      }
      'setvcp'  {
        $display = Find-Display -DeviceId $request.deviceId
        $written = Use-PhysicalMonitor -Display $display -Action {
          param($pm)
          if (-not [DeskDdc]::SetVCPFeature($pm.hPhysicalMonitor, [byte]$request.code, [uint32]$request.value)) {
            throw 'SetVCPFeature failed (' + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error() + ')'
          }
          return $true
        }
        Write-Response ([pscustomobject]@{ id = $id; ok = $true; result = [pscustomobject]@{ written = $written } })
      }
      default   {
        Write-Response ([pscustomobject]@{ id = $id; ok = $false; error = [pscustomobject]@{ code = 'UNKNOWN_COMMAND_KIND'; message = 'Unsupported op' } })
      }
    }
  } catch {
    Write-Response ([pscustomobject]@{ id = $id; ok = $false; error = [pscustomobject]@{ code = 'DEVICE_UNREACHABLE'; message = $_.Exception.Message } })
  }
}
`;
