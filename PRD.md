# 📄 [PRD] 패밀리 & 트렌드 이벤트 큐레이션 플랫폼 (EventNow)

## 1. 프로젝트 개요 (Overview)
* **서비스명:** EventNow (패밀리 & 핫플레이스 이벤트 큐레이션 서비스)
* **목적:** 아이를 동반한 가족 단위 방문객부터 2030 트렌드 세터까지 아우르는 축제, 전시회, 팝업스토어, 체험 행사 정보 제공 및 매일 자동 최신화.
* **핵심 가치:** 
  * "아이랑 주말에 어디 가지?" 고민을 해결해 주는 가족 친화적 필터링.
  * 휴먼 에러를 줄이고 데이터 누락을 방지하는 **LLM 기반 자동 크롤링 파이프라인**.

---

## 2. 주요 기능 및 요구사항 (Key Features)

### 2.1 가족/아이 동반 특화 기능 (Family-Friendly Features)
* **가족 타겟 필터 (Family Filter):**
  * `아이 동반 추천`, `체험/교육형`, `실내 공간`, `야외 축제` 카테고리/태그 분리.
  * 연령대별 필터 (영유아, 미취학 아동, 초등학생 이상).
* **편의시설 정보 제공:**
  * 각 이벤트/장소 상세 페이지에 `주차 여부`, `유모차 대여/반입 가능`, `수유실 유무`, `식음료 판매 여부` 아이콘 및 텍스트 표기.
* **예약 허들 체크:**
  * 무료/유료 여부 뿐만 아니라 `현장접수 가능` vs `사전예약 필수` 여부를 카드 목록에서 바로 인지할 수 있도록 배지(Badge) 노출.

### 2.2 자동 크롤링 및 파이프라인 (Automated Data Pipeline)
* **멀티 소스 수집기 (Multi-Source Ingestion):**
  * 공공 API (한국관광공사, 서울시 문화행사) + 웹 스크래퍼(팝업/전시 플랫폼) 병행.
* **LLM 정제 레이어 (AI Parsing Layer):**
  * 수집된 비정형 텍스트 및 HTML 데이터를 그대로 DB에 넣지 않고, **Claude API**를 거쳐 표준 JSON 규격으로 변환 및 정제.
* **중복 제거 및 갱신 (Deduplication & Upsert):**
  * 이벤트명과 개최 장소(주소)를 기준으로 유사도를 검사하여 중복 등록 방지.
  * 종료일이 지난 이벤트는 자동으로 `status = 'ended'` 처리 또는 소프트 딜리트.

---

## 3. 데이터 수집(크롤링) 상세 설계 (Data Crawling Architecture)

안정적인 자동 수집을 위해 **Python 기반 스크래퍼 + LLM 파서 + GitHub Actions** 구조를 채택합니다.

### 3.1 데이터 소스 명세 (Data Sources)
1. **정형 데이터 (API):**
   * **한국관광공사 TourAPI 4.0:** `locat_area_based_list` (지역별 행사 정보), `search_festival` (축제 정보).
   * **서울열린데이터광장:** 서울시 문화행사 정보 API (XML/JSON 지원).
2. **비정형/반정형 데이터 (Web Scraping):**
   * **Playwright + BeautifulSoup:** 동적 렌더링(JS)이 포함된 팝업스토어/전시 큐레이션 사이트 파싱.
   * **네이버 검색 API:** 매주 금요일마다 `"주말 아이와 가볼만한 곳"`, `"이번주 팝업스토어"` 키워드로 블로그/뉴스 기사 크롤링 후 텍스트 추출.

### 3.2 수집 파이프라인 프로세스 Flow
```text
[1. Trigger] 
   └── GitHub Actions (매일 새벽 4시 자동 실행)
         │
         ▼
[2. Collection Scripts (Python)]
   ├── API Fetcher (TourAPI, 서울시 API)
   └── Web Scraper (Playwright for 팝업/전시 사이트)
         │
         ▼
[3. Raw Data Staging]
   └── 임시 JSON 파일로 저장 (GitHub Artifacts 또는 Supabase Staging Table)
         │
         ▼
[4. LLM Parsing & Normalization (Claude API)]
   ├── 프롬프트: "수집된 텍스트에서 [제목, 카테고리, 시작일, 종료일, 장소, 
   │   주소, 아이동반적합여부(true/false), 태그]를 추출해 지정된 JSON Schema로 반환해라."
   └── 결과 검증 (Pydantic 등을 이용해 타입 체크)
         │
         ▼
[5. Database Upsert (Supabase PostgreSQL)]
   └── 고유 키(이벤트명 + 시작일) 기준 존재하면 UPDATE, 없으면 INSERT
```

---

## 4. 데이터베이스 스키마 설계 (Supabase PostgreSQL)

```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL, -- 'popup', 'exhibition', 'festival', 'kids_experience'
  description TEXT,
  
  -- 일정 관련
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  
  -- 위치 관련
  location_name VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  
  -- 아이/가족 동반 관련 특화 필드
  is_family_friendly BOOLEAN DEFAULT false,
  target_age_group VARCHAR(50), -- 'all', 'toddler', 'kids', 'elementary'
  amenities JSONB DEFAULT '{"parking": false, "stroller": false, "nursing_room": false}', 
  
  -- 예약 및 링크
  booking_required BOOLEAN DEFAULT false,
  price_info VARCHAR(100),
  thumbnail_url TEXT,
  official_link TEXT,
  
  -- 메타 태그 및 상태
  tags TEXT[], -- ['#실내나들이', '#체험학습', '#주말가족']
  status VARCHAR(20) DEFAULT 'ongoing', -- 'upcoming', 'ongoing', 'ended'
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_events_dates ON events(start_date, end_date);
CREATE INDEX idx_events_category ON events(category);
CREATE INDEX idx_events_family ON events(is_family_friendly);
```

---

## 5. 기술 스택 (Tech Stack)

| 구분 | 기술 스택 | 비고 |
| :--- | :--- | :--- |
| **Frontend** | Next.js (App Router), TypeScript, Tailwind CSS | SEO 최적화 및 빠르게 반응하는 UI |
| **UI Library** | shadcn/ui, Lucide React Icons | 깔끔한 디자인 시스템 및 아이콘 적용 |
| **Backend / DB** | Supabase (PostgreSQL) | 데이터베이스, API, Auth 연동 |
| **Data Collection** | Python (Playwright, BeautifulSoup, Requests) | API 호출 및 동적 웹 크롤링 |
| **AI Parsing Layer**| Claude API (Anthropic API) | 비정형 텍스트 표준 JSON 변환 |
| **Automation** | GitHub Actions | 매일 새벽 자동 크롤링 및 DB 갱신 실행 |

---

## 6. 단계별 개발 로드맵 (Phased Roadmap)

* **Phase 1: 기본 웹 서비스 구조 및 UI 구축**
  * Next.js App Router + Tailwind CSS 기반 메인 화면, 상세 페이지 UI 구현.
  * Supabase 연동 및 더미 데이터를 이용한 필터링 테스트 (가족 동반 필터, 카테고리 필터).
* **Phase 2: 공공 API 연동 및 데이터 수집 스크립트 작성**
  * Python 기반 TourAPI 및 서울시 API 수집 스크립트 작성.
  * 수집된 데이터를 Supabase에 자동 적재하는 로직 구현.
* **Phase 3: LLM 파서 및 웹 크롤러 고도화**
  * Playwright 기반 팝업스토어/전시 사이트 크롤러 개발.
  * Claude API 연동하여 비정형 텍스트에서 아이 동반 정보 및 편의시설(`amenities`)을 구조화된 JSON으로 추출하는 로직 완성.
* **Phase 4: 자동화(Automation) 및 배포**
  * GitHub Actions Cron 설정 (`.github/workflows/crawler.yml`)을 통해 매일 새벽 자동으로 크롤링 스크립트가 실행되도록 파이프라인 구축.
  * Vercel (Frontend) 배포 및 운영 안정화.
