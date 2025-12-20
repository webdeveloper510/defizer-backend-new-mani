// utils/weather.js
const axios = require('axios');

async function getWeather({ city, lat, lon }) {
  // If lat/lon not provided, geocode the city first (using Open-Meteo's Nominatim or another free API)
  let latitude = lat, longitude = lon, locationName = city;
  if (!lat || !lon) {
    // Use Nominatim (OpenStreetMap free geocoder)
    const geoRes = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: city,
        format: 'json',
        limit: 1
      }
    });
    if (!geoRes.data.length) throw new Error('City not found');
    latitude = geoRes.data[0].lat;
    longitude = geoRes.data[0].lon;
    locationName = geoRes.data[0].display_name.split(',')[0];
  }

  // Now get weather from Open-Meteo
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;
  const res = await axios.get(url);
  const w = res.data.current_weather;
  if (!w) throw new Error('Weather unavailable');

  return {
    location: locationName,
    temperature: w.temperature,
    windspeed: w.windspeed,
    winddirection: w.winddirection,
    weathercode: w.weathercode, // Can map to icon/description if desired
    time: w.time,
    summary: `Weather in **${locationName}**: ${w.temperature}°C, wind ${w.windspeed}km/h, code ${w.weathercode} (see docs for icon).`
  };
}

module.exports = { getWeather };
