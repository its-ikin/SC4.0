export type LiveWeatherReading = {
  source: "open-meteo";
  fetchedAt: string;
  temperatureC: number;
  precipitationMm: number;
  windSpeedKph: number;
  weatherCode: number;
  condition: string;
  isActiveDisruption: boolean;
};

// WMO weather codes used by Open-Meteo. https://open-meteo.com/en/docs
const WEATHER_CODE_LABELS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail"
};

const DISRUPTIVE_WEATHER_CODES = new Set([63, 65, 66, 67, 81, 82, 95, 96, 99]);

/**
 * Free, no-API-key Open-Meteo current-conditions lookup for a route's origin coordinates.
 * Returns null (never throws) on any network/parse failure so callers can fall back to a
 * purely simulated disruption model without breaking the demo.
 */
export async function fetchLiveWeather(lat: number, lng: number, timeoutMs = 4000): Promise<LiveWeatherReading | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,wind_speed_10m,weather_code&timezone=Asia%2FSingapore`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { current?: Record<string, number> };
    const current = body.current;
    if (!current) return null;

    const weatherCode = Number(current.weather_code ?? 0);
    const precipitationMm = Number(current.precipitation ?? 0);
    const windSpeedKph = Number(current.wind_speed_10m ?? 0);

    return {
      source: "open-meteo",
      fetchedAt: new Date().toISOString(),
      temperatureC: Number(current.temperature_2m ?? 0),
      precipitationMm,
      windSpeedKph,
      weatherCode,
      condition: WEATHER_CODE_LABELS[weatherCode] ?? "Unknown",
      isActiveDisruption: precipitationMm >= 2 || windSpeedKph >= 35 || DISRUPTIVE_WEATHER_CODES.has(weatherCode)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
