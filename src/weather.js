import { bindLocation } from "./locations.js";
const escape = value => String(value ?? "—").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export function mountWeather({api, farmers}) {
  const host = document.querySelector("#weather-panel");
  host.innerHTML = '<section class="weather-search"><label>Search a location<input id="weather-location" type="search"></label><label>Or use a farmer’s location<select id="weather-farmer"><option value="">Choose farmer</option></select></label><button class="ghost" id="weather-refresh">Refresh weather</button></section><section id="weather-result" aria-live="polite"><p class="empty">Choose a location to see current conditions and your three-day forecast.</p></section>';
  const select=host.querySelector("#weather-farmer"), input=host.querySelector("#weather-location");
  for (const farmer of farmers) {
    const option=document.createElement("option");
    option.value=farmer.id; option.textContent=farmer.name+" · "+farmer.location;
    option.disabled=!farmer.location_id; if(option.disabled)option.textContent+=" · select location in Edit profile"; select.append(option);
  }
  let selected, generation=0;
  async function load(place) {
    selected=place; input.value=place.label;
    const version=++generation, result=host.querySelector("#weather-result");
    result.innerHTML='<p class="empty">Checking Open-Meteo…</p>';
    try {
      const w=await api("/api/weather?locationId="+place.id);
      if(version!==generation || !host.isConnected) return;
      const n=value=>Number.isFinite(value)?escape(value):"—";
      result.innerHTML=`<section class="weather-current"><div><p>OPEN-METEO · CURRENT CONDITIONS</p><h2>${escape(w.location.label)}</h2><strong>${n(w.temperature)}<small>°C</small></strong><p>Model time: ${escape(w.observedAt)} · ${escape(w.timezone)}</p></div><div class="weather-readings"><p><span>Wind</span><b>${n(w.wind)} km/h</b></p><p><span>Humidity</span><b>${n(w.humidity)}%</b></p><p><span>Today’s rain probability</span><b>${n(w.rainProbability)}%</b></p></div></section><div class="section-title"><h3>The next three days</h3><span>Plan harvest, loading and transport</span></div><section class="weather-days">${w.daily.map(day=>`<article><p>${escape(day.date)}</p><h3>${n(day.high)}° / ${n(day.low)}°</h3><p>Rain probability <b>${n(day.rainProbability)}%</b></p><p>Precipitation <b>${n(day.precipitationMm)} mm</b></p><small>${day.rainProbability>=60?"Keep harvested stock covered; check loading conditions.":"Check conditions again before loading."}</small></article>`).join("")}</section><footer class="weather-source">Retrieved ${escape(new Date(w.retrievedAt).toLocaleString())} · <a href="${escape(w.sourceUrl)}" target="_blank" rel="noopener">Open forecast data ↗</a><p>Forecasts are model estimates. Call advice uses the location saved on the farmer’s profile; exploring this tab does not change it.</p></footer>`;
    } catch(error) {
      if(version===generation && host.isConnected) result.innerHTML='<p class="empty">'+escape(error.message)+' Use Refresh weather to retry.</p>';
    }
  }
  bindLocation(input,api,"",place=>{select.value="";load(place);});
  select.onchange=()=>{
    const farmer=farmers.find(f=>String(f.id)===select.value);
    if(farmer?.location_id) load({id:farmer.location_id,label:farmer.location});
  };
  host.querySelector("#weather-refresh").onclick=()=>{if(selected)load(selected);};
  const first=farmers.find(f=>f.location_id);
  if(first) {select.value=first.id;load({id:first.location_id,label:first.location});}
}
