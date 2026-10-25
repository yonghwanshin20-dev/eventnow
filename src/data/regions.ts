/** 특별시·광역시·도 (광역 단위) */
export type RegionCode =
  | "서울특별시"
  | "부산광역시"
  | "대구광역시"
  | "인천광역시"
  | "광주광역시"
  | "대전광역시"
  | "울산광역시"
  | "세종특별자치시"
  | "경기도"
  | "강원특별자치도"
  | "충청북도"
  | "충청남도"
  | "전북특별자치도"
  | "전라남도"
  | "경상북도"
  | "경상남도"
  | "제주특별자치도";

export const REGION_OPTIONS: { value: RegionCode | "all"; label: string }[] = [
  { value: "all", label: "전국" },
  { value: "서울특별시", label: "서울" },
  { value: "부산광역시", label: "부산" },
  { value: "대구광역시", label: "대구" },
  { value: "인천광역시", label: "인천" },
  { value: "광주광역시", label: "광주" },
  { value: "대전광역시", label: "대전" },
  { value: "울산광역시", label: "울산" },
  { value: "세종특별자치시", label: "세종" },
  { value: "경기도", label: "경기" },
  { value: "강원특별자치도", label: "강원" },
  { value: "충청북도", label: "충북" },
  { value: "충청남도", label: "충남" },
  { value: "전북특별자치도", label: "전북" },
  { value: "전라남도", label: "전남" },
  { value: "경상북도", label: "경북" },
  { value: "경상남도", label: "경남" },
  { value: "제주특별자치도", label: "제주" },
];

/** 광역시·도별 구/군 또는 시/군 */
export const SUBREGIONS_BY_REGION: Record<RegionCode, string[]> = {
  서울특별시: [
    "종로구",
    "중구",
    "용산구",
    "성동구",
    "광진구",
    "동대문구",
    "중랑구",
    "성북구",
    "강북구",
    "도봉구",
    "노원구",
    "은평구",
    "서대문구",
    "마포구",
    "양천구",
    "강서구",
    "구로구",
    "금천구",
    "영등포구",
    "동작구",
    "관악구",
    "서초구",
    "강남구",
    "송파구",
    "강동구",
  ],
  부산광역시: [
    "중구",
    "서구",
    "동구",
    "영도구",
    "부산진구",
    "동래구",
    "남구",
    "북구",
    "해운대구",
    "사하구",
    "금정구",
    "강서구",
    "연제구",
    "수영구",
    "사상구",
    "기장군",
  ],
  대구광역시: [
    "중구",
    "동구",
    "서구",
    "남구",
    "북구",
    "수성구",
    "달서구",
    "달성군",
    "군위군",
  ],
  인천광역시: [
    "중구",
    "동구",
    "미추홀구",
    "연수구",
    "남동구",
    "부평구",
    "계양구",
    "서구",
    "강화군",
    "옹진군",
    "제물포구",
    "영종구",
    "검단구",
    "서해구",
  ],
  광주광역시: ["동구", "서구", "남구", "북구", "광산구"],
  대전광역시: ["동구", "중구", "서구", "유성구", "대덕구"],
  울산광역시: ["중구", "남구", "동구", "북구", "울주군"],
  세종특별자치시: [],
  경기도: [
    "수원시",
    "성남시",
    "의정부시",
    "안양시",
    "부천시",
    "광명시",
    "평택시",
    "동두천시",
    "안산시",
    "고양시",
    "과천시",
    "구리시",
    "남양주시",
    "오산시",
    "시흥시",
    "군포시",
    "의왕시",
    "하남시",
    "용인시",
    "파주시",
    "이천시",
    "안성시",
    "김포시",
    "화성시",
    "광주시",
    "양주시",
    "포천시",
    "여주시",
    "연천군",
    "가평군",
    "양평군",
  ],
  강원특별자치도: [
    "춘천시",
    "원주시",
    "강릉시",
    "동해시",
    "태백시",
    "속초시",
    "삼척시",
    "홍천군",
    "횡성군",
    "영월군",
    "평창군",
    "정선군",
    "철원군",
    "화천군",
    "양구군",
    "인제군",
    "고성군",
    "양양군",
  ],
  충청북도: [
    "청주시",
    "충주시",
    "제천시",
    "보은군",
    "옥천군",
    "영동군",
    "증평군",
    "진천군",
    "괴산군",
    "음성군",
    "단양군",
  ],
  충청남도: [
    "천안시",
    "공주시",
    "보령시",
    "아산시",
    "서산시",
    "논산시",
    "계룡시",
    "당진시",
    "금산군",
    "부여군",
    "서천군",
    "청양군",
    "홍성군",
    "예산군",
    "태안군",
  ],
  전북특별자치도: [
    "전주시",
    "군산시",
    "익산시",
    "정읍시",
    "남원시",
    "김제시",
    "완주군",
    "진안군",
    "무주군",
    "장수군",
    "임실군",
    "순창군",
    "고창군",
    "부안군",
  ],
  전라남도: [
    "목포시",
    "여수시",
    "순천시",
    "나주시",
    "광양시",
    "담양군",
    "곡성군",
    "구례군",
    "고흥군",
    "보성군",
    "화순군",
    "장흥군",
    "강진군",
    "해남군",
    "영암군",
    "무안군",
    "함평군",
    "영광군",
    "장성군",
    "완도군",
    "진도군",
    "신안군",
  ],
  경상북도: [
    "포항시",
    "경주시",
    "김천시",
    "안동시",
    "구미시",
    "영주시",
    "영천시",
    "상주시",
    "문경시",
    "경산시",
    "의성군",
    "청송군",
    "영양군",
    "영덕군",
    "청도군",
    "고령군",
    "성주군",
    "칠곡군",
    "예천군",
    "봉화군",
    "울진군",
    "울릉군",
  ],
  경상남도: [
    "창원시",
    "진주시",
    "통영시",
    "사천시",
    "김해시",
    "밀양시",
    "거제시",
    "양산시",
    "의령군",
    "함안군",
    "창녕군",
    "고성군",
    "남해군",
    "하동군",
    "산청군",
    "함양군",
    "거창군",
    "합천군",
  ],
  제주특별자치도: ["제주시", "서귀포시"],
};

export function getSubregionOptions(
  region: RegionCode | "all",
): { value: string | "all"; label: string }[] {
  if (region === "all") return [];
  const list = SUBREGIONS_BY_REGION[region];
  if (!list.length) return [];
  const short =
    REGION_OPTIONS.find((o) => o.value === region)?.label ?? "지역";
  return [
    { value: "all", label: `${short} 전체` },
    ...list.map((name) => ({ value: name, label: name })),
  ];
}

export function getSubregionSectionLabel(region: RegionCode): string {
  if (
    region.endsWith("광역시") ||
    region === "서울특별시" ||
    region === "세종특별자치시"
  ) {
    return "구·군";
  }
  if (region === "제주특별자치도") return "시";
  return "시·군";
}

export function regionShortLabel(region: RegionCode | string): string {
  return (
    REGION_OPTIONS.find((o) => o.value === region)?.label ?? region
  );
}

/** 주소·장소명에서 세부 지역 추출 (긴 이름 우선) */

export function detectSubregion(
  region: RegionCode | string | null | undefined,
  address: string,
  district?: string | null,
): string | null {
  if (district) return district;
  if (!region || region === "all") return null;
  const list = SUBREGIONS_BY_REGION[region as RegionCode];
  if (!list?.length || !address) return null;
  // 공백 단위 정확 일치 우선 → "강서구" 주소가 부산 "서구"로 잡히지 않게
  const tokens = new Set(address.split(/[\s,()]+/));
  for (const name of list) {
    if (tokens.has(name)) return name;
  }
  const sorted = [...list].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (address.includes(name)) return name;
  }
  return null;
}

export function matchesSubregion(
  event: {
    region?: string | null;
    district?: string | null;
    address?: string | null;
    location_name?: string | null;
  },
  subregion: string,
): boolean {
  const detected =
    detectSubregion(event.region, event.address ?? "", event.district) ??
    detectSubregion(event.region, event.location_name ?? "");
  return detected === subregion;
}

const REGION_PREFIXES: { prefix: string; region: RegionCode }[] = (
  [
    ["서울", "서울특별시"],
    ["부산", "부산광역시"],
    ["대구", "대구광역시"],
    ["인천", "인천광역시"],
    ["광주", "광주광역시"],
    ["대전", "대전광역시"],
    ["울산", "울산광역시"],
    ["세종", "세종특별자치시"],
    ["경기", "경기도"],
    ["강원", "강원특별자치도"],
    ["충북", "충청북도"],
    ["충청북도", "충청북도"],
    ["충남", "충청남도"],
    ["충청남도", "충청남도"],
    ["전북", "전북특별자치도"],
    ["전라북도", "전북특별자치도"],
    ["전남", "전라남도"],
    ["전라남도", "전라남도"],
    ["경북", "경상북도"],
    ["경상북도", "경상북도"],
    ["경남", "경상남도"],
    ["경상남도", "경상남도"],
    ["제주", "제주특별자치도"],
  ] as const
)
  .map(([prefix, region]) => ({ prefix, region }))
  .sort((a, b) => b.prefix.length - a.prefix.length);

/** 주소 맨 앞의 시·도 표기로 판정 ("경기도 광주시"는 경기도). 모르면 null */
export function detectRegionFromAddress(address: string): RegionCode | null {
  const head = address.trim().replace(/^[(\[]/, "");
  // 전남·광주 통합 표기는 구 이름으로 기존 2개 광역에 나눈다
  const merged = head.match(/^전남광주(?:통합)?(?:특별시)?\s*(.*)$/);
  if (merged) {
    const gwangju = SUBREGIONS_BY_REGION["광주광역시"];
    return merged[1].split(/\s+/).some((t) => gwangju.includes(t))
      ? "광주광역시"
      : "전라남도";
  }
  for (const { prefix, region } of REGION_PREFIXES) {
    if (head.startsWith(prefix)) return region;
  }
  return null;
}

/** 지역 랜딩 페이지 슬러그 */
export const REGION_SLUGS: Record<string, RegionCode> = {
  seoul: "서울특별시",
  busan: "부산광역시",
  daegu: "대구광역시",
  incheon: "인천광역시",
  gwangju: "광주광역시",
  daejeon: "대전광역시",
  ulsan: "울산광역시",
  sejong: "세종특별자치시",
  gyeonggi: "경기도",
  gangwon: "강원특별자치도",
  chungbuk: "충청북도",
  chungnam: "충청남도",
  jeonbuk: "전북특별자치도",
  jeonnam: "전라남도",
  gyeongbuk: "경상북도",
  gyeongnam: "경상남도",
  jeju: "제주특별자치도",
};