# EventNow 배포 · 자동 업데이트 (API 키 없이, 비용 없이)

## 구조

```text
GitHub Actions (무료)  ── 매일 04:00 KST 자동 실행
        ▲                 └ 사이트의 [최신 정보 가져오기] 버튼으로 즉시 실행 (약 5분)
        │
        ├─ 수집: 대한민국 구석구석 축제 달력 + 문화포털 '한눈에 보는 문화정보'
        │        (+ 매일 실행 때만 팝업 스크래퍼)
        │        robots.txt 준수 · 1초 간격 · API 키 없음
        ├─ 정제: 규칙 기반 분류 (LLM 없음)
        ├─ 좌표: OpenStreetMap(Nominatim)으로 장소 위치 채우기 — 키 없음, 초당 1회,
        │        한 번 찾은 장소는 python/data/osm_geocode_cache.json 에 저장해 다시 묻지 않음
        ├─ 저장: src/data/events.json 병합 (git 저장소가 곧 DB)
        └─ 커밋 → Vercel(무료)이 자동 재배포 → 사이트에 반영
```

| 구성 | 비용 | 필요한 것 |
|------|------|-----------|
| GitHub 저장소 + Actions | 무료 (공개 저장소 무제한 / 비공개 월 2,000분, 1회 약 3~5분) | GitHub 계정 |
| Vercel Hobby | 무료 (비상업용) | Vercel 계정 + 저장소 연결 |
| 데이터 출처 | 무료 | **API 키 없음** |
| 지도 (OpenStreetMap) | 무료 | 없음 |

## 1. 처음 한 번 설정 (필수)

1. 이 폴더를 GitHub에 올리기

   ```bash
   git init && git add . && git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/<계정>/eventnow.git
   git push -u origin main
   ```

2. [vercel.com](https://vercel.com) → **Add New Project** → 위 저장소 **Import** → Deploy
3. GitHub 저장소 → **Actions** 탭 → **Daily Crawler** → **Run workflow** 로 첫 수집
4. 저장소에 `data: crawl …` 커밋이 생기고 1~2분 뒤 사이트에 반영되면 끝.
   이후 매일 새벽 4시에 자동으로 반복됩니다.

## 2. [최신 정보 가져오기] 버튼 켜기 (선택)

버튼은 사이트가 GitHub에 "수집을 지금 실행해 줘"라고 요청하는 기능입니다.
데이터 API 키는 필요 없고, **내 GitHub 계정에서 만드는 토큰 하나**만 있으면 됩니다 (무료).
설정하지 않으면 버튼이 보이지 않고, 매일 자동 업데이트만 동작합니다.

1. GitHub → 오른쪽 위 프로필 → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**
   - Repository access: **Only select repositories** → 이 저장소만
   - Permissions → Repository permissions → **Actions: Read and write** (나머지는 기본값)
   - 만료일은 원하는 대로 (만료되면 버튼만 동작하지 않고 매일 자동 업데이트는 계속됨)
2. Vercel 프로젝트 → **Settings → Environment Variables** 에 추가 후 **Redeploy**

   | 이름 | 값 |
   |------|----|
   | `GITHUB_DISPATCH_TOKEN` | 위에서 만든 토큰 |
   | `GITHUB_REPOSITORY` | (선택) 비워 두면 Vercel에 연결된 저장소를 자동으로 씀 |
   | `NEXT_PUBLIC_SITE_URL` | (선택) 직접 산 도메인을 연결했을 때만. 비워 두면 Vercel 주소를 자동으로 씀 |

버튼 동작:
- 누르면 축제 달력·문화포털만 빠르게 수집 (약 3분) → 커밋 → Vercel 배포 (1~2분)
- 화면에 "수집 중 → 반영 중"이 보이고, 끝나면 **새로고침** 안내가 뜹니다
- 누가 이미 실행 중이면 새로 실행하지 않고 그 진행 상황을 보여줍니다
- 마지막 실행 후 **30분 동안은 다시 실행하지 않습니다** (지인들이 여러 번 눌러도 안전)
- 토큰은 서버에만 있고 화면·브라우저로 전달되지 않습니다

## 2-1. 카카오톡 사진 카드 공유 (선택, 무료)

키가 없어도 [카카오톡] 버튼은 동작합니다 — 휴대폰에서는 공유 창(카카오톡 포함)이 뜨고, PC에서는 링크가 복사됩니다.
행사 사진·제목이 담긴 **카톡 카드**로 바로 보내려면:

1. https://developers.kakao.com → 내 애플리케이션 → 애플리케이션 추가 (이름: EventNow)
2. [앱 키]의 **JavaScript 키** 복사
3. [플랫폼 → Web] 에 사이트 도메인 등록 (예: `https://eventnow.vercel.app`)
4. Vercel → Settings → Environment Variables 에 `NEXT_PUBLIC_KAKAO_JS_KEY` = JavaScript 키 → Redeploy

JavaScript 키는 원래 브라우저에 공개되는 키라 노출돼도 괜찮습니다 (등록한 도메인에서만 동작).

## 2-2. 앱으로 쓰기 (PWA, 설정 없음)

배포하면 자동으로 **설치형 웹앱**이 됩니다. 스토어 등록·비용 없이 지인들이 홈 화면에 추가해 앱처럼 씁니다.

- **안드로이드(크롬·삼성 인터넷)**: 화면 위 [앱 설치] → 설치 창 → 홈 화면 아이콘 생성
- **아이폰(사파리)**: [앱 설치]를 누르면 "공유 → 홈 화면에 추가" 안내가 뜹니다
- **카카오톡으로 받은 링크**: 카톡 안 브라우저에서는 설치가 안 돼 [브라우저로 열기] 버튼으로 안내합니다
- 아이콘을 길게 누르면 바로가기: 이번 주말 · 다음 주말 · 달력
- 한 번 본 화면은 인터넷이 끊겨도 열립니다 (`public/sw.js`). 처음 보는 화면은 "연결 끊김" 안내
- 첫 화면을 20초쯤 둘러보면 아래에 설치 권유가 한 번 뜹니다 (닫으면 2주간 안 뜸)

서비스 워커를 크게 바꿨을 때는 `public/sw.js`의 `VERSION`을 올리면 옛 저장본이 정리됩니다.

## 3. 알아둘 점

- **데이터 보존**: 이번 수집에 안 보인 행사는 지우지 않습니다 (사이트 구조가 바뀌어 수집이 실패해도 기존
  데이터 유지). 종료 후 60일 지난 행사만 정리하며, 결과가 이전의 절반 미만이면 쓰지 않고 실패합니다.
- **같은 행사 합치기**: 축제 달력 > 문화포털 > 기존 데이터 순으로 하나만 남깁니다.
- **걸러내는 것**: 소규모 갤러리 개인전, 성인 대상 강좌 (가족 나들이에 맞지 않아서).
- **실패 알림**: 예약 실행이 실패하면 GitHub이 저장소 소유자에게 메일을 보냅니다.
- **이용 범위**: 공공기관 사이트에 공개된 화면을 하루 1~몇 회, 1초 간격으로 읽고 상세 페이지에 출처를
  표기합니다. 비상업 개인 용도 기준입니다.
- **주말 날씨**: Open-Meteo 무료 예보(키 없음, 비상업 무료)를 3시간마다 받아 기간 타일에 보여줍니다.
  지역을 고르면 그 지역 대표 도시, 아니면 서울 기준이며, 비·눈 예보가 있으면 실내 행사를 먼저 권합니다.
  예보를 못 받으면 날씨만 빠지고 나머지는 그대로입니다.
- 매일 데이터 커밋이 생기므로 공개 저장소의 예약 실행이 60일 미사용으로 꺼지지 않습니다.
- GitHub 예약 실행은 서버 사정에 따라 수십 분 늦게 시작될 수 있습니다.

## 로컬

```bash
npm run dev
npm test

cd python
python -m pytest -q
python run.py --dry-run                    # 수집·정제만 (저장 안 함)
python run.py --sources kfes,culture       # src/data/events.json 갱신
```

> 코드에는 TourAPI·서울시·Claude·Supabase 연동이 선택 기능으로 남아 있지만, 위 워크플로는
> 사용하지 않습니다 (키 없이 동작하도록 고정).
