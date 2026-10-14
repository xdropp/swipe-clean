[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

$paths = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

$items = foreach ($p in $paths) {
  Get-ItemProperty -Path $p | Where-Object { $_.DisplayName -and $_.UninstallString } | ForEach-Object {
    [pscustomobject]@{
      key             = ($_.PSPath -replace '^Microsoft\.PowerShell\.Core\\Registry::', '')
      name            = [string]$_.DisplayName
      version         = [string]$_.DisplayVersion
      publisher       = [string]$_.Publisher
      installDate     = [string]$_.InstallDate
      sizeKB          = [int64]($_.EstimatedSize -as [int64])
      location        = [string]$_.InstallLocation
      uninstall       = [string]$_.UninstallString
      icon            = [string]$_.DisplayIcon
      systemComponent = [int]($_.SystemComponent -as [int])
      parent          = [string]$_.ParentKeyName
      releaseType     = [string]$_.ReleaseType
    }
  }
}

ConvertTo-Json -InputObject @($items) -Depth 3 -Compress
