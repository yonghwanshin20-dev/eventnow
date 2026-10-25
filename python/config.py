"""EventNow crawler configuration loaded from environment variables."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    tour_api_service_key: str = ""
    # KorService2 (기본) 또는 https://apis.data.go.kr/B551011/KorService1
    tour_api_base_url: str = "https://apis.data.go.kr/B551011/KorService2"
    tour_api_mobile_app: str = "EventNow"
    tour_api_num_rows: int = 50
    tour_api_max_pages: int = 10
    # detailCommon/detailIntro 호출 상한 (항목당 2회)
    tour_api_max_detail_calls: int = 300

    @property
    def tour_api_version_suffix(self) -> str:
        """KorService2 → '2', KorService1 → '1'."""
        base = self.tour_api_base_url.rstrip("/")
        if base.endswith("KorService1"):
            return "1"
        return "2"

    anthropic_api_key: str = ""
    claude_model: str = "claude-sonnet-5-5"
    claude_batch_size: int = 3
    claude_max_tokens: int = 16000

    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # 서울 열린데이터광장 문화행사 (culturalEventInfo)
    seoul_api_key: str = ""
    # 네이버 검색 API (블로그·뉴스)
    naver_client_id: str = ""
    naver_client_secret: str = ""
    # 카카오 로컬 API (지오코딩)
    kakao_rest_api_key: str = ""
    # 실패/부분 실패 알림
    slack_webhook_url: str = ""

    # 저장소: auto = Supabase 키가 있으면 supabase, 없으면 json(git 커밋)
    store: str = "auto"
    # 정제기: auto = ANTHROPIC_API_KEY 가 있으면 claude, 없으면 rules(무료)
    parser: str = "auto"
    events_json_path: Path = BASE_DIR.parent / "src" / "data" / "events.json"
    events_meta_path: Path = BASE_DIR.parent / "src" / "data" / "events-meta.json"
    json_retention_days: int = 60
    # 키 없는 좌표 채우기 (OpenStreetMap Nominatim, 초당 1회) — 실행당 조회 상한
    osm_geocode: bool = True
    osm_max_lookups: int = 150
    osm_cache_path: Path = BASE_DIR / "data" / "osm_geocode_cache.json"
    # 좌표 → 동 역지오코딩 저장본 (커밋해 매일 재사용)
    osm_reverse_cache_path: Path = BASE_DIR / "data" / "osm_reverse_cache.json"
    # 문화포털 상세 화면 저장본 (커밋해 매일 새 행사만 읽게)
    culture_detail_cache_path: Path = BASE_DIR / "data" / "culture_detail_cache.json"
    seoul_detail_cache_path: Path = BASE_DIR / "data" / "seoul_detail_cache.json"
    # 국가유산(사적·명승) 소개 글·사진 — 한 번 읽으면 저장해 두고 새 곳만 읽는다
    heritage_detail_cache_path: Path = BASE_DIR / "data" / "heritage_detail_cache.json"

    raw_data_dir: Path = BASE_DIR / "data" / "raw"
    parsed_data_dir: Path = BASE_DIR / "data" / "parsed"
    geocode_cache_path: Path = BASE_DIR / "data" / "geocode_cache.json"

    dry_run: bool = False


settings = Settings()
