import type { RegionCode } from "@/data/regions";
import { addDays, daysBetween } from "@/lib/dates";

/**
 * 주말 날씨 — Open-Meteo (키 없음·무료, 비상업 이용). 16일 예보라 이번·다음 주말을 모두 덮는다.
 * 지역을 고르면 그 지역 대표 도시, 아니면 서울 기준. 실패하면 날씨만 빠지고 사이트는 그대로.
 */

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

export interface DayWeather {
  date: string;
  kind: WeatherKind;
  /** 최고·최저 기온 (°C, 반올림) */
  tmax: number;
  tmin: number;
  /** 강수 확률 최댓값 (%) */
  pop: number;
}

export interface Forecast {
  /** 예보 기준 지역 이름 ("서울") */
  place: string;
  days: DayWeather[];
}

/** 광역 단위 대표 지점 (시·도청 또는 가장 큰 도시) */
const REGION_POINTS: Record<RegionCode, { lat: number; lng: number; name: string }> = {
  서울특별시: { lat: 37.5665, lng: 126.978, name: "서울" },
  부산광역시: { lat: 35.1796, lng: 129.0756, name: "부산" },
  대구광역시: { lat: 35.8714, lng: 128.6014, name: "대구" },
  인천광역시: { lat: 37.4563, lng: 126.7052, name: "인천" },
  광주광역시: { lat: 35.1595, lng: 126.8526, name: "광주" },
  대전광역시: { lat: 36.3504, lng: 127.3845, name: "대전" },
  울산광역시: { lat: 35.5384, lng: 129.3114, name: "울산" },
  세종특별자치시: { lat: 36.48, lng: 127.289, name: "세종" },
  경기도: { lat: 37.2636, lng: 127.0286, name: "수원" },
  강원특별자치도: { lat: 37.8813, lng: 127.7298, name: "춘천" },
  충청북도: { lat: 36.6424, lng: 127.489, name: "청주" },
  충청남도: { lat: 36.8151, lng: 127.1139, name: "천안" },
  전북특별자치도: { lat: 35.8242, lng: 127.148, name: "전주" },
  전라남도: { lat: 34.9507, lng: 127.4872, name: "순천" },
  경상북도: { lat: 36.019, lng: 129.3435, name: "포항" },
  경상남도: { lat: 35.2279, lng: 128.6811, name: "창원" },
  제주특별자치도: { lat: 33.4996, lng: 126.5312, name: "제주" },
};

/** WMO 날씨 코드 → 종류 */
export function weatherKind(code: number): WeatherKind {
  if (code === 0) return "clear";
  if (code <= 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy";
}

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: "맑음",
  partly: "구름 조금",
  cloudy: "흐림",
  fog: "안개",
  drizzle: "이슬비",
  rain: "비",
  snow: "눈",
  storm: "뇌우",
};

/** 나들이에 비가 걱정되는 날: 비·눈·뇌우 예보이거나 강수 확률 50% 이상 */
export function isWetDay(d: DayWeather): boolean {
  return d.kind === "rain" || d.kind === "snow" || d.kind === "storm" || d.pop >= 50;
}

interface OpenMeteoDaily {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: (number | null)[];
  };
}

export function parseForecast(json: OpenMeteoDaily, place: string): Forecast | null {
  const d = json.daily;
  if (!d?.time?.length || !d.weather_code || !d.temperature_2m_max || !d.temperature_2m_min) {
    return null;
  }
  const days: DayWeather[] = d.time.map((date, i) => ({
    date,
    kind: weatherKind(d.weather_code![i] ?? 3),
    tmax: Math.round(d.temperature_2m_max![i] ?? 0),
    tmin: Math.round(d.temperature_2m_min![i] ?? 0),
    pop: Math.round(d.precipitation_probability_max?.[i] ?? 0),
  }));
  return { place, days };
}

export async function getForecast(region: RegionCode | "all"): Promise<Forecast | null> {
  const point = REGION_POINTS[region === "all" ? "서울특별시" : region];
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${point.lat}&longitude=${point.lng}` +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&timezone=Asia%2FSeoul&forecast_days=16";
  try {
    // 3시간마다 갱신 (지역 17곳 × 하루 8번이면 무료 한도에 한참 못 미친다)
    const res = await fetch(url, {
      next: { revalidate: 10800 },
      // 첫 화면이 날씨를 기다리느라 늦어지지 않게 짧게 — 늦으면 날씨만 빠진다
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    return parseForecast((await res.json()) as OpenMeteoDaily, point.name);
  } catch {
    return null;
  }
}

/** [from, to] 기간의 날씨 (예보 범위 밖이면 빈 배열) */
export function weatherFor(forecast: Forecast | null, [from, to]: [string, string]): DayWeather[] {
  if (!forecast) return [];
  const n = daysBetween(from, to);
  const wanted = new Set(Array.from({ length: n + 1 }, (_, i) => addDays(from, i)));
  return forecast.days.filter((d) => wanted.has(d.date));
}
