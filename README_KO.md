# dsh-harness-chat-control

[简体中文](README.md) · [English](README_EN.md) · [日本語](README_JA.md)

DSH Desktop의 대화 인터랙션을 ChatGPT와 비슷하게 만들어 주는 플러그인입니다.

> **프로젝트 목표: ChatGPT의 두 가지 인용 대화 흐름을 재현합니다.**
>
> 1. **메인 대화에서 인용**: 답변을 인용하고 같은 대화에서 계속 질문합니다.
> 2. **사이드바 대화에서 인용**: 인용 내용을 Better Sidebar로 가져와 메인 대화를 바꾸지 않고 독립된 사이드바 세션에서 질문합니다.

## 화면 예시

### 메인 대화 인용

답변의 텍스트를 선택하거나 작업 표시줄의 **인용**을 클릭합니다. 인용은 입력창의 주석 칩으로 유지되며, 질문을 편집한 뒤 전송할 수 있습니다.

![메인 대화 인용 예시](docs/screenshots/main-conversation-quote.svg)

### 사이드바 대화 인용

**사이드바에서 질문**을 클릭하거나 텍스트 선택 도구 모음에서 **사이드바 채팅에서 질문**을 선택합니다. Better Sidebar의 기본 입력창과 모델 선택기를 그대로 사용합니다. 인용 칩 바깥의 문자는 모두 사용자가 입력하며, **전송**을 누르기 전에는 답변이 시작되지 않습니다.

![사이드바 대화 인용 예시](docs/screenshots/sidebar-conversation-quote.svg)

## 기능

- **메인 대화 인용**: 답변 전체 또는 선택한 일부를 인용합니다. `>`나 `---` 같은 Markdown 기호가 본문에 섞이지 않습니다.
- **기본 주석 칩**: 인용은 입력창의 `주석 1개` 칩으로 표시되며, 전송 전에 질문을 편집하거나 칩을 삭제할 수 있습니다.
- **기본 사이드바 입력창**: Better Sidebar의 `SideChatView`와 DSH의 `InputBar`를 사용하며 별도의 텍스트 상자를 만들지 않습니다. 메인 세션과 사이드바 세션은 서로 독립적입니다.
- **모델 선택**: 기본 모델 선택은 현재 사이드바 세션에만 적용됩니다.
- **편집 후 다시 보내기**: 사용자 메시지 옆의 연필 버튼을 누르면 원문이 기본 입력창에 들어옵니다. 전송하면 같은 대화의 원래 위치에서 보이는 분기를 교체합니다.
- **생성 중지**: DSH의 기본 중지/전송 상태를 재사용하며 이벤트를 중복 전송하지 않습니다.

이 플러그인은 인용 칩, 진입점, 세션 라우팅만 추가합니다. 입력창, 권한, 모델 메뉴, 답변 렌더링은 DSH Harness와 Better Sidebar의 기본 컴포넌트가 담당합니다.

## 호환 버전

| 구성 요소 | 버전 |
| --- | --- |
| DSH Desktop (Windows) | `0.7.2` |
| DeepSeek Harness / `@deepseek-ai/dsh` | `0.1.2-alpha.1` |
| `dsh-better-sidebar` | **`0.17.1`** |
| Node.js | `>=20` |
| pnpm | `10.x` 또는 `11.x` |

`dsh-better-sidebar@0.18.x`는 Harness `0.1.2-rc.1+`를 대상으로 하며 alpha.1에 없는 `connection.state.getSnapshot()`을 읽습니다. DSH Desktop `0.7.2`에서는 Sidebar를 `0.17.1`로 고정하세요. 그렇지 않으면 새 대화를 열 때 `Cannot read properties of undefined (reading 'getSnapshot')` 오류가 발생할 수 있습니다.

## 설치

Windows PowerShell에서 현재 안정 버전 설치 명령을 실행합니다.

```powershell
$script = (irm 'https://raw.githubusercontent.com/1985899182/dsh-harness-chat-control/v0.2.60/scripts/install.ps1').TrimStart([char]0xFEFF)
& ([scriptblock]::Create($script)) -Ref 'v0.2.60'
```

설치 프로그램은 플러그인을 DSH Desktop의 `web` 프로필에 추가합니다. 최초 세대 설치이거나 플러그인이 실행 중이 아니면 안전하게 스테이징하고 DSH Desktop을 완전히 종료한 뒤 다시 시작하도록 안내합니다. 이미 실행 중인 플러그인을 업그레이드할 때만 Web Client를 HMR로 동기화한 뒤 페이지를 `Ctrl+R`로 새로 고칩니다.

설치 소스는 명시적인 HTTPS Git URL이므로 pnpm이 GitHub 단축 표기를 SSH로 해석하지 않습니다. 설치 프로그램은 기존 `HTTP_PROXY`/`HTTPS_PROXY` 환경 변수 또는 WinINET 프록시를 확인한 뒤 pnpm, git, node 자식 프로세스에 전달합니다. 직접 지정할 수도 있습니다.

```powershell
& ([scriptblock]::Create($script)) -Ref 'v0.2.60' -Proxy 'http://127.0.0.1:7897'
```

registry가 느리면 registry URL과 재시도 횟수를 지정합니다.

```powershell
& ([scriptblock]::Create($script)) -Ref 'v0.2.60' -Registry 'https://registry.npmjs.org/' -FetchRetries 5
```

이 명령은 다운로드한 스크립트를 메모리의 `scriptblock`으로 실행하므로 PowerShell 실행 정책을 바꿀 필요가 없습니다. `.ps1` 파일로 저장해 직접 실행하려면 `powershell -ExecutionPolicy Bypass -File`을 사용하세요.

프로필이 이미 Sidebar `0.18.x`를 사용한다면 먼저 다음 호환성 수정 명령을 실행합니다.

```powershell
$desktopNode = 'D:\DSH\DSH Desktop\resources\app\node_modules\node\bin\node.exe'
$desktopDsh = 'D:\DSH\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js'
$env:DSH_HOME = "$env:APPDATA\dsh-desktop\harness"
& $desktopNode $desktopDsh plugin --profile web add --save-exact dsh-better-sidebar@0.17.1
```

그 후 안정 버전 설치 명령을 다시 실행하고 페이지를 새로 고침합니다.

dshmarket가 HTTP 502 등의 핫 마운트 오류를 반환하면 설치 프로그램은 토큰을 가린 HTTP 상태와 응답 본문을 표시하고 콜드 스타트가 필요하다고 안내합니다. 프록시 시간 초과를 설치 성공으로 처리하지 않습니다.

## 사용 방법

1. **메인 대화**: 답변 작업 표시줄에서 **인용**을 클릭하거나 텍스트를 선택한 뒤 **대화에 추가**를 선택하고 질문을 입력해 전송합니다.
2. **사이드바 대화**: **사이드바에서 질문**을 클릭하거나 선택 도구 모음에서 **사이드바 채팅에서 질문**을 선택하고, 모델을 고른 다음 질문을 입력해 전송합니다.
3. **편집 후 다시 보내기**: 사용자 메시지 옆의 연필 버튼을 클릭하고 기본 입력창에서 문장을 수정해 전송합니다. 새 답변은 원래 위치에 표시됩니다.

## 개발

```powershell
npm test
```

매니페스트, 로더 선언, PowerShell 설치 프로그램, JavaScript 구문을 검증합니다.

## 릴리스

현재 마일스톤은 **`v0.2.60`**이며 DSH Desktop `0.7.2` / Harness `0.1.2-alpha.1`에서 검증되었습니다. DSH 또는 Harness의 메이저 버전을 올린 뒤에는 기본 Slot과 상태 인터페이스를 다시 확인하세요.

## 라이선스

MIT
