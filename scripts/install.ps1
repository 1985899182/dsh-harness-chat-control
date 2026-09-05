[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')]
    [string]$Profile = 'web',

    [ValidatePattern('^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$')]
    [string]$Ref = 'v0.2.37',

    [string]$DesktopRoot,

    [string]$WebUrl,

    [switch]$SkipLiveMount,

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PluginName = 'dsh-harness-chat-control'
$Repository = '1985899182/dsh-harness-chat-control'
$SupportedHarnessVersion = '0.1.2-alpha.1'
$SupportedPnpmMajors = @(10, 11)
$NodeRelativePath = 'resources\app\node_modules\node\bin\node.exe'
$DshRelativePath = 'resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js'
$DshPackageRelativePath = 'resources\app\node_modules\@deepseek-ai\dsh\package.json'
$GenerationInstallerRelativePath = 'resources\app\node_modules\dsh-desktop-market-installer\index.js'

function Resolve-DesktopInstallation {
    param(
        [string]$RequestedRoot
    )

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($RequestedRoot)) {
        $candidates += $RequestedRoot
    }
    if (-not [string]::IsNullOrWhiteSpace($env:DSH_DESKTOP_ROOT)) {
        $candidates += $env:DSH_DESKTOP_ROOT
    }
    $candidates += 'D:\DSH\DSH Desktop'
    foreach ($environmentVariable in @('LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)')) {
        $basePath = [Environment]::GetEnvironmentVariable($environmentVariable)
        if (-not [string]::IsNullOrWhiteSpace($basePath)) {
            $candidates += (Join-Path $basePath 'DSH Desktop')
        }
    }

    $seen = @{}
    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        $root = [System.IO.Path]::GetFullPath($candidate)
        if ($seen.ContainsKey($root)) {
            continue
        }
        $seen[$root] = $true

        $nodePath = Join-Path $root $NodeRelativePath
        $dshPath = Join-Path $root $DshRelativePath
        $manifestPath = Join-Path $root $DshPackageRelativePath
        $generationInstallerPath = Join-Path $root $GenerationInstallerRelativePath
        if ((Test-Path -LiteralPath $nodePath -PathType Leaf) -and
            (Test-Path -LiteralPath $dshPath -PathType Leaf) -and
            (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            return [PSCustomObject]@{
                Root = $root
                NodePath = $nodePath
                DshPath = $dshPath
                ManifestPath = $manifestPath
                GenerationInstallerPath = $generationInstallerPath
            }
        }
    }

    throw '未找到 DSH Desktop 内置 CLI。请使用 -DesktopRoot 指定 DSH Desktop 的安装目录。'
}

function Assert-CommandAvailable {
    param(
        [string]$CommandName,
        [string]$InstallHint
    )

    if ($null -eq (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "未在 PATH 中找到 $CommandName。$InstallHint"
    }
}

function Get-ProfilePnpmVersion {
    param(
        [string]$ProfileRoot
    )

    $modulesManifestPath = Join-Path $ProfileRoot 'node_modules\.modules.yaml'
    if (-not (Test-Path -LiteralPath $modulesManifestPath -PathType Leaf)) {
        return $null
    }

    $modulesManifest = Read-JsonFile -Path $modulesManifestPath
    $packageManager = [string]$modulesManifest.packageManager
    $match = [regex]::Match($packageManager, '^pnpm@(?<version>\d+(?:\.\d+){1,2})$')
    if (-not $match.Success) {
        return $null
    }
    return [version]$match.Groups['version'].Value
}

function Get-ActivePnpmVersion {
    $versionText = (& pnpm --version 2>$null | Select-Object -First 1)
    $match = [regex]::Match([string]$versionText, '^\s*(?<version>\d+(?:\.\d+){1,2})')
    if (-not $match.Success) {
        return $null
    }
    return [version]$match.Groups['version'].Value
}

function Use-ProfilePnpm {
    param(
        [string]$ProfileRoot
    )

    $profileVersion = Get-ProfilePnpmVersion -ProfileRoot $ProfileRoot
    if ($null -eq $profileVersion) {
        return $null
    }

    $activeVersion = Get-ActivePnpmVersion
    if ($null -eq $activeVersion) {
        throw '无法读取 pnpm 版本。请确认 pnpm 10 或 11 已加入 PATH。'
    }
    if ($activeVersion.Major -notin $SupportedPnpmMajors) {
        throw "当前 pnpm 版本为 $activeVersion；本插件要求 pnpm 10.x 或 11.x。"
    }
    if ($profileVersion.Major -notin $SupportedPnpmMajors) {
        throw "当前 profile 记录的 pnpm 版本为 $profileVersion；本插件支持 pnpm 10.x 或 11.x。"
    }
    if ($activeVersion.Major -eq $profileVersion.Major) {
        Write-Host "使用 PATH 中的 pnpm $activeVersion（profile 已使用 pnpm $profileVersion）。"
        return $null
    }

    $corepack = Get-Command corepack -ErrorAction SilentlyContinue
    if ($null -eq $corepack) {
        throw "当前 profile 使用 pnpm $profileVersion，但 PATH 中是 pnpm $activeVersion，且未找到 Corepack。请安装 pnpm $profileVersion，或启用随 Node.js 提供的 Corepack。"
    }

    $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-harness-chat-control-pnpm-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    $shimPath = Join-Path $temporaryRoot 'pnpm.cmd'
    $corepackPath = [System.IO.Path]::GetFullPath($corepack.Path)
    $shimContent = "@echo off`r`n`"$corepackPath`" pnpm@$profileVersion %*`r`n"
    Set-Content -LiteralPath $shimPath -Value $shimContent -Encoding ASCII

    $originalPath = $env:PATH
    $env:PATH = "$temporaryRoot;$originalPath"
    Write-Host "当前 profile 使用 pnpm $profileVersion，而 PATH 中是 pnpm $activeVersion；已临时切换到 Corepack 的 pnpm $profileVersion。"
    return [PSCustomObject]@{
        OriginalPath = $originalPath
        TemporaryRoot = $temporaryRoot
    }
}

function Read-JsonFile {
    param(
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "缺少预期文件：$Path"
    }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function ConvertTo-LoopbackWebUri {
    param(
        [string]$Candidate
    )

    if ([string]::IsNullOrWhiteSpace($Candidate)) {
        return $null
    }

    $parsed = $null
    if (-not [System.Uri]::TryCreate($Candidate, [System.UriKind]::Absolute, [ref]$parsed)) {
        return $null
    }
    if ($parsed.Scheme -ne 'http' -or -not $parsed.IsLoopback -or $parsed.Port -le 0) {
        return $null
    }
    return $parsed
}

function New-DshMarketRouteUri {
    param(
        [System.Uri]$WebUri,
        [string]$Path
    )

    # Keep the short-lived Harness token from the discovered Web URL while
    # replacing only the route path.  The token is never written to output.
    $authority = $WebUri.GetLeftPart([System.UriPartial]::Authority)
    $query = $WebUri.Query
    return New-Object -TypeName System.Uri -ArgumentList ("$authority$Path$query")
}

function Get-DshMarketStatus {
    param(
        [System.Uri]$WebUri
    )

    try {
        $statusUri = New-DshMarketRouteUri -WebUri $WebUri -Path '/dsh-market/installed'
        $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $statusUri -TimeoutSec 4
        if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
            return $null
        }
        $payload = $response.Content | ConvertFrom-Json
        if ($null -eq $payload -or $null -eq $payload.PSObject.Properties['profile']) {
            return $null
        }
        return [PSCustomObject]@{
            Uri = $WebUri
            Data = $payload
        }
    } catch {
        # Endpoint discovery is best effort.  A stale port/token or a DSH
        # build without dshmarket must fall back to the safe cold-start path.
        return $null
    }
}

function Get-RunningDshWebEndpoint {
    param(
        [string]$RequestedUrl,
        [string]$ProfileName
    )

    $candidates = @()
    $seen = @{}
    if (-not [string]::IsNullOrWhiteSpace($RequestedUrl)) {
        $requestedUri = ConvertTo-LoopbackWebUri -Candidate $RequestedUrl
        if ($null -eq $requestedUri) {
            throw '-WebUrl 只允许指向本机 DSH Web 地址（http://127.0.0.1、localhost 或 [::1]）。'
        }
        $candidates += $requestedUri
    }

    $logPath = $null
    if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
        $logPath = Join-Path $env:APPDATA 'dsh-desktop\logs\harness.log'
    }
    if ($null -ne $logPath -and (Test-Path -LiteralPath $logPath -PathType Leaf)) {
        $webPattern = 'dsh web:\s+(?<url>http://(?:127\.0\.0\.1|localhost|\[::1\]):\d+/\?token=[A-Za-z0-9_-]+)'
        $logLines = @(Get-Content -LiteralPath $logPath -Tail 4000)
        for ($index = $logLines.Count - 1; $index -ge 0; $index -= 1) {
            $match = [regex]::Match([string]$logLines[$index], $webPattern)
            if (-not $match.Success) {
                continue
            }
            $candidate = ConvertTo-LoopbackWebUri -Candidate $match.Groups['url'].Value
            if ($null -eq $candidate -or $seen.ContainsKey($candidate.AbsoluteUri)) {
                continue
            }
            $candidates += $candidate
            $seen[$candidate.AbsoluteUri] = $true
        }
    }

    foreach ($candidate in $candidates) {
        $status = Get-DshMarketStatus -WebUri $candidate
        if ($null -eq $status) {
            continue
        }
        $profileProperty = $status.Data.PSObject.Properties['profile']
        if ($null -ne $profileProperty -and [string]$profileProperty.Value -eq $ProfileName) {
            return $status
        }
    }
    return $null
}

function Get-InstalledPackageProperty {
    param(
        [object]$StatusData
    )

    if ($null -eq $StatusData -or $null -eq $StatusData.PSObject.Properties['installed']) {
        return $null
    }
    $installed = $StatusData.installed
    if ($null -eq $installed) {
        return $null
    }
    return $installed.PSObject.Properties[$PluginName]
}

function Get-ActivationState {
    param(
        [object]$StatusData
    )

    if ($null -eq $StatusData -or $null -eq $StatusData.PSObject.Properties['activation']) {
        return $null
    }
    $activation = $StatusData.activation
    if ($null -eq $activation) {
        return $null
    }
    $pluginActivation = $activation.PSObject.Properties[$PluginName]
    if ($null -eq $pluginActivation -or $null -eq $pluginActivation.Value) {
        return $null
    }
    $state = $pluginActivation.Value.PSObject.Properties['state']
    if ($null -eq $state) {
        return $null
    }
    return [string]$state.Value
}

function Get-ProfilePackageTarget {
    param(
        [string]$ProfileRoot
    )

    $packagePath = Join-Path $ProfileRoot (Join-Path 'node_modules' $PluginName)
    $packageItem = Get-Item -LiteralPath $packagePath -Force -ErrorAction SilentlyContinue
    if ($null -eq $packageItem) {
        return $null
    }

    # DSH Desktop projects generation packages as junctions.  Capture the
    # target before projection switches the profile to the new generation:
    # ClientModuleRegistry in an already-running Harness still watches this
    # old path, so the installer can copy only the Web Client artifact there
    # and let the built-in HMR deliver it without restarting DSH.
    $target = @($packageItem.Target) | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace([string]$target)) {
        return $null
    }
    try {
        return [System.IO.Path]::GetFullPath([string]$target)
    } catch {
        return $null
    }
}

function Invoke-DshMarketHotMount {
    param(
        [System.Uri]$WebUri,
        [string]$ProfileName
    )

    # Generation projection and the running market are separate pieces of
    # state.  Wait briefly for the projected package to become visible before
    # asking dshmarket to mount it, otherwise a fast install can race its own
    # symlink publication.
    $installed = $false
    for ($attempt = 0; $attempt -lt 4; $attempt += 1) {
        $status = Get-DshMarketStatus -WebUri $WebUri
        if ($null -ne $status -and [string]$status.Data.profile -eq $ProfileName) {
            $installed = $null -ne (Get-InstalledPackageProperty -StatusData $status.Data)
            if ($installed) {
                if ((Get-ActivationState -StatusData $status.Data) -eq 'live') {
                    return [PSCustomObject]@{
                        Ok = $false
                        AlreadyLive = $true
                        NeedsRefresh = $false
                        Restart = $true
                        Reason = '插件已在当前 Harness 进程中运行,跳过重复热挂载'
                    }
                }
                break
            }
        }
        if ($attempt -lt 3) {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $installed) {
        return [PSCustomObject]@{
            Ok = $false
            AlreadyLive = $false
            NeedsRefresh = $false
            Restart = $true
            Reason = '运行中的 dshmarket 尚未看到新安装的插件'
        }
    }

    try {
        $toggleUri = New-DshMarketRouteUri -WebUri $WebUri -Path '/dsh-market/toggle'
        $origin = $WebUri.GetLeftPart([System.UriPartial]::Authority)
        $body = @{ name = $PluginName; enabled = $true } | ConvertTo-Json -Compress
        $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $toggleUri `
            -Headers @{ Origin = $origin } -ContentType 'application/json' -Body $body -TimeoutSec 20
        $result = $response.Content | ConvertFrom-Json

        $activationState = $null
        if ($null -ne $result.PSObject.Properties['activation'] -and $null -ne $result.activation) {
            $activationProperty = $result.activation.PSObject.Properties[$PluginName]
            if ($null -ne $activationProperty -and $null -ne $activationProperty.Value) {
                $stateProperty = $activationProperty.Value.PSObject.Properties['state']
                if ($null -ne $stateProperty) {
                    $activationState = [string]$stateProperty.Value
                }
            }
        }
        $live = $false
        if ($null -ne $result.PSObject.Properties['live'] -and $null -ne $result.live) {
            $live = @($result.live) -contains $PluginName
        }
        $ok = $false
        if ($null -ne $result.PSObject.Properties['ok']) {
            $ok = [bool]$result.ok
        }
        $ok = $ok -and ($activationState -eq 'live' -or $live)
        $refresh = $true
        if ($null -ne $result.PSObject.Properties['refresh']) {
            $refresh = [bool]$result.refresh
        }
        $restart = $false
        if ($null -ne $result.PSObject.Properties['restart']) {
            $restart = [bool]$result.restart
        }
        $reason = $null
        if (-not $ok -and $null -ne $result.PSObject.Properties['reason']) {
            $reason = [string]$result.reason
        }
        if ([string]::IsNullOrWhiteSpace($reason)) {
            $reason = 'dshmarket 未确认插件已热挂载'
        }
        return [PSCustomObject]@{
            Ok = $ok
            AlreadyLive = $false
            NeedsRefresh = $refresh
            Restart = $restart -or -not $ok
            Reason = $reason
            ActivationState = $activationState
        }
    } catch {
        # Do not echo the exception: WebRequest errors can include the token
        # embedded in the local URL.  The caller prints a safe fallback.
        return [PSCustomObject]@{
            Ok = $false
            AlreadyLive = $false
            NeedsRefresh = $false
            Restart = $true
            Reason = '调用运行中的 dshmarket 热挂载接口失败'
        }
    }
}

function Remove-LegacyProfilePackage {
    param(
        [string]$ProfileRoot,
        [object]$ProfileManifest
    )

    $dependencies = @{}
    if ($null -ne $ProfileManifest.dependencies) {
        foreach ($property in $ProfileManifest.dependencies.PSObject.Properties) {
            $dependencies[$property.Name] = [string]$property.Value
        }
    }
    if (-not $dependencies.ContainsKey($PluginName)) {
        return
    }

    $projection = $null
    try {
        $projection = $ProfileManifest.dsh.desktop.generationProjection.plugins
    } catch {
        $projection = $null
    }
    if ($null -ne $projection -and $null -ne $projection.PSObject.Properties[$PluginName]) {
        Write-Host "$PluginName 已由 DSH Desktop 代际安装管理，跳过旧版清理。"
        return
    }

    $packagePath = Join-Path $ProfileRoot (Join-Path 'node_modules' $PluginName)
    $packageItem = Get-Item -LiteralPath $packagePath -Force -ErrorAction SilentlyContinue
    $isReparsePoint = $null -ne $packageItem -and (($packageItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
    if ($isReparsePoint) {
        Write-Host "$PluginName 当前是代际链接，跳过旧版清理。"
        return
    }

    Write-Host "$PluginName 是旧的共享 profile 安装，先移除后切换到 DSH Desktop 代际安装。"
    & $desktop.NodePath $desktop.DshPath plugin --profile $Profile remove $PluginName
    if ($LASTEXITCODE -ne 0) {
        throw "无法移除旧的 $PluginName 安装（退出码：$LASTEXITCODE）。"
    }
}

$desktop = Resolve-DesktopInstallation -RequestedRoot $DesktopRoot
$dshManifest = Read-JsonFile -Path $desktop.ManifestPath
if ($dshManifest.version -ne $SupportedHarnessVersion) {
    Write-Warning "当前 DSH Harness 版本为 $($dshManifest.version)，本插件仅在 $SupportedHarnessVersion 上完成验证；将继续安装，但请在重启后检查界面功能。"
}

Assert-CommandAvailable -CommandName 'pnpm' -InstallHint '请先安装 pnpm 10 或 11，并重新打开终端。'
Assert-CommandAvailable -CommandName 'git' -InstallHint 'GitHub 源码安装需要 Git，请先安装 Git 并重新打开终端。'

if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
    throw '无法读取 APPDATA，无法确定 DSH Desktop 的 Harness home。'
}
$env:DSH_HOME = Join-Path $env:APPDATA 'dsh-desktop\harness'
$packageSpec = "github:$Repository#$Ref"
$profileRoot = Join-Path $env:DSH_HOME (Join-Path 'profiles' $Profile)
$profileManifestPath = Join-Path $env:DSH_HOME (Join-Path 'profiles' (Join-Path $Profile 'package.json'))

Write-Host "DSH Desktop：$($desktop.Root)"
Write-Host "Harness home：$env:DSH_HOME"
Write-Host "目标 profile：$Profile"
Write-Host "插件来源：$packageSpec"

if ($DryRun) {
    Write-Host 'Dry run：未修改 DSH profile。将执行：'
    Write-Host "若 profile 中存在旧的共享安装，将先执行：& '$($desktop.NodePath)' '$($desktop.DshPath)' plugin --profile $Profile remove $PluginName"
    Write-Host "然后通过 DSH Desktop 代际安装器安装：$packageSpec"
    if ($SkipLiveMount) {
        Write-Host '并跳过运行中 Harness 的 dshmarket 热挂载。'
    } else {
        Write-Host '若 DSH Desktop 正在运行且提供 dshmarket，将安装后热挂载插件；用户只需刷新 Web 页面。'
    }
    return
}

# Capture the pre-install state before the profile is changed.  A package that
# is already live must not be mounted a second time under the same loader name:
# the running process would then contain two fibers and the new one could win
# only until the next refresh.  Fresh installs (or installed-but-not-live
# packages) are safe to hand to dshmarket's official hot-mount route.
$profileHadPlugin = $false
$previousLivePackageDirectory = $null
if (Test-Path -LiteralPath $profileManifestPath -PathType Leaf) {
    try {
        $beforeManifest = Read-JsonFile -Path $profileManifestPath
        $profileHadPlugin = $null -ne $beforeManifest.dependencies.PSObject.Properties[$PluginName]
    } catch {
        $profileHadPlugin = $false
    }
}
if ($profileHadPlugin) {
    $previousLivePackageDirectory = Get-ProfilePackageTarget -ProfileRoot $profileRoot
    if ($null -ne $previousLivePackageDirectory) {
        Write-Host "已记录当前运行代际客户端路径：$previousLivePackageDirectory"
    }
}
$runningEndpoint = $null
$runningPluginWasLive = $false
if (-not $SkipLiveMount) {
    $runningEndpoint = Get-RunningDshWebEndpoint -RequestedUrl $WebUrl -ProfileName $Profile
    if ($null -ne $runningEndpoint) {
        $runningPluginWasLive = (Get-ActivationState -StatusData $runningEndpoint.Data) -eq 'live'
        Write-Host '已发现正在运行的 DSH Web 与 dshmarket；安装后将尝试热挂载。'
    } else {
        Write-Host '未发现可用的运行中 dshmarket；安装会先安全暂存，随后按需提示重启。'
    }
}

$pnpmState = Use-ProfilePnpm -ProfileRoot $profileRoot
try {
    $existingManifest = Read-JsonFile -Path $profileManifestPath
    Remove-LegacyProfilePackage -ProfileRoot $profileRoot -ProfileManifest $existingManifest

    if (-not (Test-Path -LiteralPath $desktop.GenerationInstallerPath -PathType Leaf)) {
        Write-Warning '当前 DSH Desktop 未提供代际安装器，将回退到内置 CLI 安装。'
        & $desktop.NodePath $desktop.DshPath plugin --profile $Profile add --save-exact $packageSpec
        if ($LASTEXITCODE -ne 0) {
            throw "DSH 插件安装失败（退出码：$LASTEXITCODE）。请保留上方 pnpm 输出以便排查。"
        }
    } else {
        $helperUrl = "https://raw.githubusercontent.com/$Repository/$Ref/scripts/install-generation.mjs"
        $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-harness-chat-control-generation-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
        $helperPath = Join-Path $temporaryRoot 'install-generation.mjs'
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $helperUrl -OutFile $helperPath
            $helperArguments = @(
                '--desktop-root', $desktop.Root,
                '--profile', $Profile,
                '--repository', $Repository,
                '--ref', $Ref
            )
            if ($runningPluginWasLive -and $null -ne $previousLivePackageDirectory) {
                $helperArguments += @(
                    '--sync-live-client',
                    '--previous-package-directory', $previousLivePackageDirectory
                )
                Write-Host '当前 Harness 已加载旧代际；安装后将把新的 Web Client 同步到该路径，触发 DSH 内置 HMR。'
            }
            & $desktop.NodePath $helperPath @helperArguments
            if ($LASTEXITCODE -ne 0) {
                throw "DSH Desktop 代际安装失败（退出码：$LASTEXITCODE）。请保留上方安装输出以便排查。"
            }
        } finally {
            if (Test-Path -LiteralPath $temporaryRoot) {
                Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
            }
        }
    }
} finally {
    if ($null -ne $pnpmState) {
        $env:PATH = $pnpmState.OriginalPath
        $temporaryRoot = [System.IO.Path]::GetFullPath($pnpmState.TemporaryRoot)
        $temporaryParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        if ($temporaryRoot.StartsWith($temporaryParent, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $temporaryRoot)) {
            Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
        }
    }
}

$profileManifest = Read-JsonFile -Path $profileManifestPath
$bundles = @($profileManifest.dsh.profile.bundles)
$dependencyNames = @()
if ($null -ne $profileManifest.dependencies) {
    $dependencyNames = @($profileManifest.dependencies.PSObject.Properties.Name)
}
if ($dependencyNames -notcontains $PluginName) {
    throw "安装后未在 $profileManifestPath 的 dependencies 中找到 $PluginName。"
}
if ($bundles -notcontains $PluginName) {
    throw "安装后未在 dsh.profile.bundles 中找到 $PluginName；DSH 未将该插件注册为 profile layer。"
}

Write-Host "安装并验证成功：$PluginName 已注册到 profile '$Profile'。"

if ($SkipLiveMount) {
    Write-Host '已按 -SkipLiveMount 跳过运行中热挂载；请完全退出并重新打开 DSH Desktop。'
    return
}

if ($null -eq $runningEndpoint) {
    # The app may have started between the preflight and this point.  Discover
    # it once more for a fresh install, but never risk a duplicate mount when
    # the profile already contained this plugin before the command ran.
    if (-not $profileHadPlugin) {
        $runningEndpoint = Get-RunningDshWebEndpoint -RequestedUrl $WebUrl -ProfileName $Profile
    }
}

if ($null -eq $runningEndpoint) {
    Write-Warning '安装已完成，但未找到运行中的 dshmarket 热挂载接口；请完全退出并重新打开 DSH Desktop。'
    return
}

if ($runningPluginWasLive) {
    if ($null -ne $previousLivePackageDirectory) {
        Write-Host '已同步当前运行 Harness 正在监视的 Web Client 文件；请刷新 DSH 页面（Ctrl+R），无需重启 DSH Desktop。'
        return
    }
    Write-Warning '当前运行中的 Harness 已加载旧版 dsh-harness-chat-control，但未能解析其代际客户端路径；为避免重复 Loader，更新将在下次完全重启 DSH Desktop 时生效。'
    return
}

$hotMount = Invoke-DshMarketHotMount -WebUri $runningEndpoint.Uri -ProfileName $Profile
if ($hotMount.AlreadyLive) {
    Write-Warning '插件在安装过程中已经由当前 Harness 加载；为避免重复 Loader，本次不再热挂载，更新将在下次完全重启时生效。'
} elseif ($hotMount.Ok) {
    Write-Host '已通过运行中的 dshmarket 热挂载插件；请刷新 DSH Web 页面即可启动/显示插件。'
    if ($hotMount.NeedsRefresh) {
        Write-Host '提示：刷新当前 DSH 页面（Ctrl+R）即可加载新的 Web Client 代码，无需重启 DSH Desktop。'
    }
} else {
    Write-Warning "安装已完成，但当前 DSH 未确认热挂载：$($hotMount.Reason)"
    Write-Warning '插件已安全暂存到 profile；请完全退出并重新打开 DSH Desktop 后再检查。'
}
