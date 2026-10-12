# Builds and signs the cloud-connected Android APK on Windows. No signing secret
# is sent to GitHub or stored in the repository. Requires PowerShell 7 and Java 21.
[CmdletBinding()]
param(
    [string]$JavaDirectory = $env:JAVA_HOME,
    [string]$SdkDirectory = $env:ANDROID_HOME,
    [string]$BuildToolsVersion = '36.0.0',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'This signing helper uses Windows DPAPI. See docs/ANDROID_CLOUD.md for other systems.' }

$projectDirectory = Join-Path $PSScriptRoot '../android-cloud'
$javaExe = Join-Path $JavaDirectory 'bin/java.exe'
$keytoolExe = Join-Path $JavaDirectory 'bin/keytool.exe'
$toolsDirectory = Join-Path $SdkDirectory "build-tools/$BuildToolsVersion"
$zipalignExe = Join-Path $toolsDirectory 'zipalign.exe'
$apksignerExe = Join-Path $toolsDirectory 'apksigner.bat'
foreach ($toolPath in @($javaExe, $keytoolExe, $zipalignExe, $apksignerExe)) {
    if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) { throw "Required Android tool not found: $toolPath" }
}

$oldJavaDirectory = $env:JAVA_HOME
$oldSdkDirectory = $env:ANDROID_HOME
$oldSigningPassword = $env:FORGEFIT_SIGNING_PASSWORD
try {
    $env:JAVA_HOME = $JavaDirectory
    $env:ANDROID_HOME = $SdkDirectory
    if (-not $SkipBuild) {
        Push-Location $projectDirectory
        try {
            & './gradlew.bat' --no-daemon assembleRelease lintRelease
            if ($LASTEXITCODE -ne 0) { throw 'Android build or lint failed. No APK was signed.' }
        } finally { Pop-Location }
    }

    $outputsDirectory = Join-Path $projectDirectory 'app/build/outputs/apk/release'
    $metadata = Get-Content -LiteralPath (Join-Path $outputsDirectory 'output-metadata.json') -Raw | ConvertFrom-Json
    if ($metadata.applicationId -ne 'com.forgefit.app' -or $metadata.elements.Count -ne 1) {
        throw 'Unexpected Android package or multiple APK outputs; refusing to sign.'
    }
    $apkMetadata = $metadata.elements[0]
    if ($apkMetadata.versionName -notmatch '^[0-9A-Za-z.-]+$' -or $apkMetadata.outputFile -ne 'app-release-unsigned.apk') {
        throw 'Unexpected APK version or output path; refusing to sign.'
    }
    $unsignedApk = Join-Path $outputsDirectory $apkMetadata.outputFile

    # Protect the directory BEFORE generating the key. Keep this outside OneDrive
    # and the public repository; only the current Windows user and SYSTEM can read it.
    $signingDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ForgeFit/AndroidSigning'
    if (-not (Test-Path -LiteralPath $signingDirectory)) {
        $null = New-Item -ItemType Directory -Path $signingDirectory
        $acl = Get-Acl -LiteralPath $signingDirectory
        $acl.SetAccessRuleProtection($true, $false)
        $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $systemUser = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
        foreach ($identity in @($currentUser, $systemUser)) {
            $rule = [Security.AccessControl.FileSystemAccessRule]::new(
                $identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'
            )
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $signingDirectory -AclObject $acl
    }

    $keystorePath = Join-Path $signingDirectory 'forgefit-release.keystore'
    $passwordPath = Join-Path $signingDirectory 'signing-secrets.dpapi.xml'
    if ((Test-Path -LiteralPath $keystorePath) -and -not (Test-Path -LiteralPath $passwordPath)) {
        throw 'The signing key exists but its protected password is missing. Restore it; do not generate a replacement key.'
    }
    if (-not (Test-Path -LiteralPath $passwordPath)) {
        $randomBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
        $securePassword = ConvertTo-SecureString ([Convert]::ToBase64String($randomBytes)) -AsPlainText -Force
        # Export-Clixml encrypts this SecureString using this Windows user's DPAPI.
        $securePassword | Export-Clixml -LiteralPath $passwordPath
    }
    $securePassword = Import-Clixml -LiteralPath $passwordPath
    $credential = [pscredential]::new('forgefit', $securePassword)
    $env:FORGEFIT_SIGNING_PASSWORD = $credential.GetNetworkCredential().Password
    if (-not (Test-Path -LiteralPath $keystorePath)) {
        & $keytoolExe -genkeypair -keystore $keystorePath -storetype PKCS12 -alias forgefit `
            -keyalg RSA -keysize 3072 -validity 10950 -dname 'CN=ForgeFit' `
            -storepass:env FORGEFIT_SIGNING_PASSWORD -keypass:env FORGEFIT_SIGNING_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'Could not generate the release signing key.' }
    }

    $artifactsDirectory = Join-Path $projectDirectory 'artifacts'
    $null = New-Item -ItemType Directory -Path $artifactsDirectory -Force
    $alignedApk = Join-Path $artifactsDirectory 'app-release-aligned.apk'
    $signedApk = Join-Path $artifactsDirectory "ForgeFit-$($apkMetadata.versionName).apk"
    & $zipalignExe -P 16 -f 4 $unsignedApk $alignedApk
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    & $apksignerExe sign --ks $keystorePath --ks-key-alias forgefit `
        --ks-pass env:FORGEFIT_SIGNING_PASSWORD --key-pass env:FORGEFIT_SIGNING_PASSWORD `
        --out $signedApk $alignedApk
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
    $verification = & $apksignerExe verify --verbose --print-certs $signedApk
    if ($LASTEXITCODE -ne 0) { throw 'Signed APK verification failed.' }
    $certificateLine = $verification | Where-Object { $_ -match '^Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})$' }
    if (-not $certificateLine -or $certificateLine -notmatch 'digest: ([0-9a-f]{64})$') { throw 'Missing signing certificate digest.' }
    $fingerprint = ($Matches[1].ToUpperInvariant() -split '(?<=\G..)(?!$)') -join ':'
    $verification | Write-Output

    $websiteAssociationPath = Join-Path $PSScriptRoot '../frontend/public/.well-known/assetlinks.json'
    if (Test-Path -LiteralPath $websiteAssociationPath) {
        $websiteAssociations = Get-Content -LiteralPath $websiteAssociationPath -Raw | ConvertFrom-Json
        $matchingAssociation = @($websiteAssociations | Where-Object {
            $_.target.namespace -eq 'android_app' -and $_.target.package_name -eq 'com.forgefit.app' -and
            $_.target.sha256_cert_fingerprints -ccontains $fingerprint
        })
        if ($matchingAssociation.Count -eq 0) {
            throw 'The signing key does not match the website verification file. Stop and restore the original key; do not publish this APK.'
        }
    }

    $association = @(@{
        relation = @('delegate_permission/common.handle_all_urls')
        target = @{
            namespace = 'android_app'
            package_name = 'com.forgefit.app'
            sha256_cert_fingerprints = @($fingerprint)
        }
    })
    ConvertTo-Json -InputObject $association -Depth 6 |
        Set-Content -LiteralPath (Join-Path $artifactsDirectory 'assetlinks.generated.json') -Encoding utf8
    $apkHash = (Get-FileHash -LiteralPath $signedApk -Algorithm SHA256).Hash.ToLowerInvariant()
    "$apkHash  $([IO.Path]::GetFileName($signedApk))" |
        Set-Content -LiteralPath (Join-Path $artifactsDirectory 'SHA256SUMS.txt') -Encoding ascii
    Write-Output "Signed APK: $signedApk"
    Write-Output "Public certificate fingerprint: $fingerprint"
    Write-Output "Private signing-key directory (do not upload): $signingDirectory"
} finally {
    $env:FORGEFIT_SIGNING_PASSWORD = $oldSigningPassword
    $env:JAVA_HOME = $oldJavaDirectory
    $env:ANDROID_HOME = $oldSdkDirectory
}
