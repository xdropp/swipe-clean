[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

$apps = Get-AppxPackage | Where-Object {
  -not $_.IsFramework -and -not $_.NonRemovable -and -not $_.IsResourcePackage -and
  -not $_.IsBundle -and $_.SignatureKind -eq 'Store'
}

$out = foreach ($a in $apps) {
  $display = $a.Name
  try {
    $m = Get-AppxPackageManifest -Package $a.PackageFullName
    $dn = [string]$m.Package.Properties.DisplayName
    if ($dn -and $dn -notlike 'ms-resource:*') { $display = $dn }
  } catch {}
  $installed = ''
  try { $installed = (Get-Item -LiteralPath $a.InstallLocation).CreationTime.ToString('yyyyMMdd') } catch {}
  [pscustomobject]@{
    name            = $display
    packageFullName = $a.PackageFullName
    publisher       = ($a.Publisher -replace '^CN=([^,]+).*$', '$1')
    version         = [string]$a.Version
    location        = [string]$a.InstallLocation
    installDate     = $installed
  }
}

ConvertTo-Json -InputObject @($out) -Depth 3 -Compress
