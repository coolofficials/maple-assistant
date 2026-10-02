# 구현 검증 기록

검증 환경은 macOS, Node.js 24, Electron 44.5.1입니다. 아래 실행은 구현 담당 agent `repo-20f899b2-fef`가 수행했으며 원격 GitHub 작업은 수행하지 않았습니다. Reviewer에서 tool artifact에 직접 접근할 수 없는 경우 이 파일의 명령과 요약을 기준으로 확인하세요.

## 최종 timer/character revision 확인

- Main-process `NotificationScheduler`가 최초 지연 후 주기 알림을 지속 소유합니다. Renderer deadline 만료는 IPC 알림을 취소하지 않으며, pause/stop/resync/mute만 schedule ID를 취소합니다. Scheduler 응답의 main `scheduledAt`를 사용해 IPC 전달 지연을 UI deadline에 반영합니다.
- Sub-second resume 지연(1ms 이상)을 지원합니다. schedule 요청 응답이 pause/stop/mute 뒤 도착하면 generation mismatch로 반환된 실제 ID를 취소합니다.
- 실행 당시 스킬 snapshot과 선택 selector를 분리합니다. 실행 중 캐릭터/skill 선택을 바꿔도 countdown/resync/delete는 snapshot skill로 동작하며, stop 후 start는 현재 UI 선택을 씁니다.

## Revision 2 수정 확인

- 반복 알림은 명시 선택된 활성 스킬의 불변 snapshot을 사용합니다. 반복 만료, 남은 시간 pause/resume, 시스템 알림 mute/unmute, 실행 중 재동기화, 예약 취소 및 활성 스킬 삭제 시 정합성을 테스트합니다.
- 캐릭터별 감소율/감소 초를 기록하고 스킬은 사용 캐릭터를 명시 선택합니다. 감소 설정은 계산에 사용하지 않습니다. 기존 문자열 캐릭터 백업은 가져올 때 기본 스펙/기존 캐릭터 대상 관계로 마이그레이션하며, 이후 백업 왕복과 존재하지 않는 캐릭터 참조를 검사합니다.
- 캡처 수동 중지, pending 시작 취소, 가져오기로 인한 종료 및 OS track ended에서 stream/interval/observer 정리와 접근 가능한 상태 텍스트를 함께 확인합니다.

## 기존 구현 경계 확인

- Vite `base: './'`와 상대 stylesheet/module 경로를 적용했습니다. `npm run smoke:startup`은 production `dist`를 `file://`로 띄워 editor와 observer의 실제 JS/CSS startup을 확인합니다.
- 앱 내부 nav 링크는 제한된 section으로 scroll하되 URL hash를 바꾸지 않습니다. 방어용 trusted URL 비교도 `#timer/#todos/#pip/#data`만 허용하고 origin/path/query 및 다른 fragment는 일치해야 합니다. IPC, permission, observer 및 navigation 비교가 같은 helper를 사용합니다.
- `npm run dev`는 Electron main/preload을 먼저 compile하고 Vite, watch compiler, 산출 파일 모두 준비될 때까지 기다립니다. `npm run smoke:dev-cold`는 `dist-electron`을 지운 뒤 실제 `npm run dev`를 시작하여 TypeScript 오류 없음, Vite ready, Electron editor ready를 확인합니다.
- 캐릭터 입력은 앱 내 dialog/form입니다. 빈 이름, 길이 초과, 대소문자 무시 중복 및 예약된 `account` 이름을 거절합니다.
- renderer 텍스트/ID는 DOM API의 `textContent`/`dataset`으로 삽입합니다. load/import/모든 일반 저장 전에 동일한 `validateAppData` schema/개수 검사를 적용합니다. 알 수 없는 키, 잘못된 UUID/날짜, 중복 ID/캐릭터, 미존재 캐릭터 scope/선택 캐릭터 및 최대 개수 초과를 거절하고 기존 저장/UI model을 보존합니다.
- 모든 top-level navigation/new window를 제한하고, IPC에서 editor main-frame과 정확한 dev/file URL을 검사합니다. 캡처 source ID는 main의 OS 목록과 대조합니다. 외부 콘텐츠에는 preload를 전달하지 않으며 observer IPC는 권한 호출을 거부합니다.
- 일반 권한은 거절하되, 정확한 trusted editor main-frame의 선택된 캡처 source에 한해 `mediaTypes: []` display-media permission을 허용합니다. 별도 display-media handler에서 frame/origin/user gesture/video-only/선택 source를 재검증합니다. 일반 camera/microphone/media 권한은 허용하지 않습니다.
- Notification은 renderer API가 아니라 검증된 IPC를 통해 main-process repeating scheduler/native `Notification`으로 예약합니다. Main-process scheduler가 초기 지연과 반복 기한을 소유하며 renderer countdown 만료가 실제 예약을 취소하지 않습니다. editor를 숨긴 실제 Electron smoke에서 native `show()` 호출을 확인했습니다. 지원하지 않는 OS/실패는 renderer 내 카운트다운으로 처리합니다.
- import/re-render/unload/중지 시 타이머·알림 예약·capture track·interval·observer를 정리합니다. capture는 상태 lock과 cancel token으로 중복/늦은 stream을 정리하고 종료 상태도 `role=status` 영역에 갱신합니다.
- 할 일 표시는 keyed row node를 재사용하여 매초 checked/class/text만 갱신하고 window focus/visibility 복귀 시에도 재계산합니다. daily/weekly/custom 경계와 포커스 유지/체크 조작 fake-clock UI 테스트를 포함합니다.

## 재현 가능한 명령과 결과

```sh
npm ci
npm test
npm run typecheck
npm audit
npm run smoke:dev-cold
npm run smoke:startup
npm run smoke:navigation:dev
npm run smoke:navigation:file
npm run smoke:capture
npm run smoke:notification
npm run dist:win
```

| 확인 | 결과 |
|---|---|
| `npm test` | 35 tests 통과: production `NotificationScheduler` 실제 발화 시각/반복/취소, IPC 지연, 500ms resume, stale response 역순, active snapshot 삭제, 캐릭터 선택/spec 전환, capture 상태 및 기존 schema/KST/IPC |
| `npm run typecheck` | renderer와 Electron main/preload 통과 |
| `npm audit` | 취약점 0 |
| `npm run smoke:dev-cold` | `dist-electron` 삭제 후 fresh `npm run dev`; watcher/Vite 준비 후 `MAPLE_EDITOR_READY` 확인 |
| `npm run smoke:startup` | Electron production `file://` editor/observer JS/CSS 로딩 확인 (`MAPLE_EDITOR_READY`, `MAPLE_OBSERVER_READY`) |
| `npm run smoke:navigation:dev` / `smoke:navigation:file` | Electron dev와 file mode에서 각 `#timer/#todos/#pip/#data` 클릭 후 trust URL 유지, source list/select, 실제 capture stream start/track stop, notification schedule/cancel IPC 확인 (`MAPLE_NAV_IPC_OK` 4 routes per mode) |
| `npm run smoke:capture` | Electron OS source 목록 → trusted IPC 선택 → display-capture 권한 → `getDisplayMedia` stream start 및 모든 track stop → observer startup 성공. 프레임/캡처 이미지 저장 또는 전송은 하지 않음. |
| `npm run smoke:notification` | editor를 숨긴 상태에서 main-process timer 만료 및 native notification `show()` 호출 확인 |
| `npm run dist:win` | Windows x64 NSIS 설치 파일 생성 성공 (`release/Maple Assistant Setup 0.1.0.exe`) |

최종 revision 전체 명령 evidence: owner `repo-c9cf0379-2d9`, artifact `044a5951-9e6d-44d7-b98c-9bd13b669909` (exit 0; production scheduler tests, cold dev/file startup, dev/file navigation IPC, capture, hidden native notification, macOS NSIS cross-package). NSIS 산출물은 기본 Electron icon을 사용합니다. Windows에서 설치/실행하지 않았습니다.

## 제한

Electron runtime 및 화면 capture smoke는 현재 macOS 개발 세션에서 확인했습니다. Windows NSIS는 macOS에서 cross-package했으며 Windows 설치/실행, OS별 권한 차이, MapleStory 실제 플레이/창 호환성, 가려짐·최소화 capture는 확인하지 않았습니다. 다른 영상 창 배치는 해결하지 않습니다. 생성된 installer/build outputs는 gitignore 대상이며 저장소에 포함하지 않았습니다.
