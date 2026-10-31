# Sets the Worker's two secrets, and checks them, without showing or saving either one.
# Running it again replaces the access token, so every device must enter the new one.
$ErrorActionPreference = 'Stop'
$workerUrl = 'https://lounge-tracker.jgjy926.workers.dev'
Set-Location (Split-Path $PSScriptRoot -Parent)
Add-Type -AssemblyName System.Net.Http

function Get-Status($url, $method, $headerName, $headerValue) {
  $client = New-Object System.Net.Http.HttpClient
  try {
    $request = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($method)), $url)
    [void]$request.Headers.TryAddWithoutValidation($headerName, $headerValue)
    [void]$request.Headers.TryAddWithoutValidation('Depth', '0')
    return [int]$client.SendAsync($request).GetAwaiter().GetResult().StatusCode
  } finally {
    $client.Dispose()
  }
}

$email = Read-Host 'Koofr email'
$secure = Read-Host 'Koofr app password (not your login password)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
$koofrAuth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${email}:${password}"))

Write-Host 'Checking Koofr...'
$status = Get-Status 'https://app.koofr.net/dav/Koofr/' 'PROPFIND' 'Authorization' $koofrAuth
if ($status -ne 207) {
  Write-Host "Koofr refused these details (HTTP $status). Nothing was changed." -ForegroundColor Red
  exit 1
}
Write-Host 'Koofr accepted them.' -ForegroundColor Green

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = -join ($bytes | ForEach-Object { $_.ToString('x2') })

Write-Host 'Saving the secrets to the Worker...'
$koofrAuth | npx wrangler secret put KOOFR_AUTH_HEADER | Out-Null
$token | npx wrangler secret put APP_API_KEY | Out-Null
Start-Sleep -Seconds 5

$ping = Get-Status "$workerUrl/api/ping" 'GET' 'X-App-Auth' $token
$sync = Get-Status "$workerUrl/api/sync" 'GET' 'X-App-Auth' $token
if ($ping -eq 200 -and $sync -eq 200) {
  Write-Host 'Worker check passed (ping and sync).' -ForegroundColor Green
} else {
  Write-Host "Worker check failed: ping HTTP $ping, sync HTTP $sync." -ForegroundColor Red
}

Set-Clipboard -Value $token
Write-Host ''
Write-Host 'Your access token is on the clipboard. Paste it into your password manager now.' -ForegroundColor Yellow
Write-Host 'Each device enters it once, in Settings. It cannot be read back from Cloudflare.'
