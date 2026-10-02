# 메이플 어시스턴트

메이플스토리 플레이를 돕는 Windows 데스크톱 앱입니다. 재획 타이머, 캐릭터/계정 메할일, 사용자가 직접 선택하는 로컬 화면 미리보기를 제공합니다.

> 비공식 보조 도구입니다. 게임 쿨타임 감소 규칙 및 게임/OS별 동작은 검증·보증하지 않습니다. 게임 자동 입력, 메모리 접근, 프로세스 주입, 탐지 회피 기능은 없습니다.

## 기능

- 스킬별 사용 캐릭터를 복수 선택하고 반복 알림에 사용할 스킬을 명시합니다. 알림은 선택 스킬의 기본 쿨타임 또는 실효 쿨타임 override를 반복 사용하며, pause/resume은 남은 시간을 보존하고 mute/unmute 및 실행 중 재동기화를 지원합니다. 스킬/캐릭터 감소율 및 감소 초는 기록만 하며 검증되지 않은 감소 공식은 적용하지 않습니다.
- 메할일을 계정 공통 또는 선택 캐릭터로 등록하고 일일/주간/사용자 지정(일 단위) 반복 및 KST 초기화 시각을 설정합니다.
- 화면 PiP는 Electron이 OS에서 제공받은 창/화면 목록을 앱에 표시하며 사용자가 대상을 선택하고 시작할 때만 선택된 소스의 캡처 스트림을 엽니다. 와이드/정사각형/전체 화면 crop을 적용하고 별도 observer 창에 로컬 프레임을 표시합니다. observer는 비포커스(always-on-top 요청) 관찰 창이며 입력 전달은 하지 않습니다.
- JSON 내보내기/가져오기를 지원합니다. 데이터는 Electron renderer의 로컬 저장소에 보관합니다. 캡처 프레임은 저장하거나 업로드하지 않습니다.

## 사용법

1. Windows에서 서명되지 않은 설치 프로그램 실행 시 OS의 보안 경고가 표시될 수 있습니다. 배포 전 출처와 해시를 확인하세요.
2. 재획 알림 탭에서 스킬, 기본 쿨타임(초), 사용 캐릭터를 선택해 추가합니다. 실제 게임에서 확인한 실효 쿨타임은 override에 입력하세요. 반복 알림 스킬을 직접 선택한 뒤 시작합니다. 실행 중 캐릭터/스킬 선택을 바꿔도 현재 타이머는 시작 당시 스킬로 유지되며 화면 선택은 다음 시작에 적용됩니다. 일시정지/재개는 남은 시간을 유지하고 음소거는 시스템 알림만 끕니다. 재동기화는 실행 중 스킬의 실효 주기로 main-process 반복 알림을 다시 예약합니다.
3. 메할일에 계정 공통/현재 캐릭터 항목을 추가하고 반복 주기와 KST 시각을 선택합니다. 체크는 해당 reset period에만 유지됩니다.
4. 화면 PiP에서 OS 캡처 소스 목록을 불러와 대상을 선택한 뒤 명시적으로 시작합니다. 끝나면 캡처 중지 버튼을 누릅니다. 허용되는 창 및 캡처 품질은 OS/드라이버에 따라 다릅니다.
5. 현재 캐릭터 쿨타임 감소 설정은 기록용이며 알림 계산에 자동 적용되지 않습니다. 데이터 백업에는 캐릭터별 설정과 스킬-캐릭터 사용 관계가 포함됩니다. 기존 문자열 캐릭터 형식 백업은 가져올 때 기본 감소 설정과 기존 캐릭터 전체 사용 스킬 관계로 마이그레이션됩니다.

축소 미리보기는 다른 영상 창 배치를 해결하지 않습니다. 원본 게임 포커스, 다른 창의 배치, 가려지거나 최소화된 창의 캡처, 실제 게임과의 호환성을 보장하지 않습니다. 캡처 대상에 민감한 정보가 보이지 않도록 주의하세요.

## 개발 및 빌드

Node.js 22 이상 권장.

```sh
npm ci
npm run dev
npm run smoke:dev-cold
npm run smoke:startup
npm run smoke:navigation:dev
npm run smoke:navigation:file
npm test
npm run typecheck
npm run build
```

Windows 설치 파일은 Windows 환경에서 `npm run dist:win`을 실행해 생성합니다 (`release/`). GitHub Actions의 `.github/workflows/release.yml`은 `v*` 태그에서 Windows NSIS 설치 파일을 빌드하고 GitHub Release에 첨부하도록 준비되어 있습니다. 현재 저장소에는 remote를 설정하지 않았으며 원격 게시를 수행하지 않았습니다.

`npm run smoke:dev-cold`는 `dist-electron` 산출물이 없는 상태에서 실제 `npm run dev`를 시작하여 TypeScript/watch/Vite 준비 후 editor window가 로드되는지 확인합니다. `npm run smoke:startup`은 Vite production asset 상대 경로와 editor/observer 창의 JS/CSS startup을 Electron runtime에서 점검합니다. `npm run smoke:navigation:dev`와 `npm run smoke:navigation:file`은 각 내부 탭 링크를 클릭한 후 capture 목록/선택/start/stop 및 notification schedule/cancel IPC를 실제 Electron dev/file 모드에서 검사합니다. OS 화면 녹화 권한이 허용된 개발 장치에서는 `npm run smoke:capture`로 실제 Electron display-capture API도 별도 점검할 수 있습니다. `npm run smoke:notification`은 editor를 숨기고 main-process deadline 만료와 native notification 표시 호출을 확인합니다. OS 화면 목록/권한이 없는 headless 또는 제한된 장치에서는 capture smoke가 실패할 수 있습니다.

자세한 재현 명령과 검증 범위/제한은 [`VERIFICATION.md`](VERIFICATION.md)를 참고하세요.

## 보안 및 개인정보

Electron은 `contextIsolation`, `sandbox`, `nodeIntegration: false`를 사용합니다. preload는 제한된 IPC만 노출하며 main은 trusted editor의 main-frame sender/URL을 확인하고 observer 및 외부 페이지의 privileged IPC를 거부합니다. 새 창/외부 navigation과 일반 권한 요청은 차단됩니다. 화면 캡처는 선택된 OS 창/화면 source에 대해 main이 user gesture와 video-only request를 검증한 경우에만 `getDisplayMedia`로 허용합니다. 앱은 네트워크 API/업로드 기능을 포함하지 않습니다.

이 소프트웨어는 MIT License로 배포됩니다. 의존성 라이선스는 npm 패키지 메타데이터를 확인하세요.
