[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')]
    [string]$Profile = 'web',

    [ValidatePattern('^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$')]
    [string]$Ref = 'main',

    [string]$DesktopRoot,

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
        if ((Test-Path -LiteralPath $nodePath -PathType Leaf) -and
            (Test-Path -LiteralPath $dshPath -PathType Leaf) -and
            (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            return [PSCustomObject]@{
                Root = $root
                NodePath = $nodePath
                DshPath = $dshPath
                ManifestPath = $manifestPath
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
    Write-Host "& '$($desktop.NodePath)' '$($desktop.DshPath)' plugin --profile $Profile add --save-exact '$packageSpec'"
    return
}

$pnpmState = Use-ProfilePnpm -ProfileRoot $profileRoot
try {
    & $desktop.NodePath $desktop.DshPath plugin --profile $Profile add --save-exact $packageSpec
    if ($LASTEXITCODE -ne 0) {
        throw "DSH 插件安装失败（退出码：$LASTEXITCODE）。请保留上方 pnpm 输出以便排查。"
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
Write-Host '请完全退出并重新打开 DSH Desktop，使新的 Web Client 插件生效。'
